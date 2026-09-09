import {
  createClosedBackgroundDataSessionController,
} from './closedDataSessionController';
import { createClosedBackgroundMessageRouter } from './aiMessageRouter';
import { createIframeSummaryBroker } from './iframeSummaryBroker';
import { createSealedSnapshotStore } from './sealedSnapshotStore';
import { createBackgroundProviderBoundary, type SummaryProvider } from '../ai/providers/backgroundProviderBoundary';
import {
  backgroundActiveSnapshotRecoveryRequestSchema,
  contentCapabilityMessageSchema,
  iframeCapabilityMessageSchema,
} from '../ai/contracts/messages';
import { NHI_CLOUD_ORIGIN } from '../ai/session/closedDataSessionLifecycle';

type ChromeMessageSender = Readonly<{
  tab?: Readonly<{ id?: number; url?: string }>;
  origin?: string;
  url?: string;
}>;

type ChromeRuntimeEvents = Readonly<{
  getURL?: (path: string) => string;
  onMessage: Readonly<{
    addListener: (
      listener: (
        message: unknown,
        sender: ChromeMessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean,
    ) => void;
  }>;
}>;

type ChromeTabEvents = Readonly<{
  onRemoved: Readonly<{ addListener: (listener: (tabId: number) => void) => void }>;
  sendMessage?: (tabId: number, message: unknown) => Promise<unknown>;
}>;

type ChromePermissionEvents = Readonly<{
  contains: (permissions: Readonly<{origins: readonly string[]}>) => Promise<boolean>;
}>;

export type ClosedBackgroundRuntimeChrome = Readonly<{
  runtime: ChromeRuntimeEvents;
  tabs: ChromeTabEvents;
  permissions?: ChromePermissionEvents;
}>;

/**
 * Installs the closed lifecycle at the actual MV3 event seams. Chrome supplies
 * the sender tab and origin; callers can neither select a target tab nor pass
 * a URL through a message. This deliberately owns no legacy action messages.
 */
export function installClosedBackgroundRuntime(chromeApi: ClosedBackgroundRuntimeChrome) {
  const snapshots = createSealedSnapshotStore();
  const provider = createBackgroundProviderBoundary({
    fetch(url, init) {
      return globalThis.fetch(url, init);
    },
    ensureOptionalHostPermission(providerName: SummaryProvider) {
      const origin = providerName === 'ollama'
        ? 'http://127.0.0.1:11434/*'
        : 'https://openrouter.ai/*';
      return chromeApi.permissions?.contains({origins: [origin]}) ?? Promise.resolve(false);
    },
  });
  const controller = createClosedBackgroundDataSessionController({
    storeSnapshot(scope, snapshot) {
      return snapshots.put(scope, snapshot);
    },
    cancel(scope) {
      snapshots.discard(scope);
      provider.cancel(scope);
    },
  });
  const router = createClosedBackgroundMessageRouter({
    allowedContentOrigin: 'https://medcloud2.nhi.gov.tw',
    allowedIframeUrl: chromeApi.runtime.getURL?.('ai-frame.html') ?? 'chrome-extension://unavailable/ai-frame.html',
    activeScopeForTab: controller.activeScopeForTab,
  });
  const iframe = createIframeSummaryBroker({router, snapshots, provider});

  async function recoverCurrentSnapshot(
    message: Extract<ReturnType<typeof iframeCapabilityMessageSchema.parse>, {type: 'iframe.summary.review' | 'iframe.summary.copy'}>,
    sender: ChromeMessageSender,
  ): Promise<boolean> {
    const tabId = sender.tab?.id;
    const contentUrl = sender.tab?.url;
    if (tabId === undefined || contentUrl === undefined || chromeApi.tabs.sendMessage === undefined) return false;
    try {
      if (new URL(contentUrl).origin !== NHI_CLOUD_ORIGIN) return false;
    } catch {
      return false;
    }

    let recoveryInput: unknown;
    try {
      recoveryInput = await chromeApi.tabs.sendMessage(tabId, backgroundActiveSnapshotRecoveryRequestSchema.parse({
        schemaVersion: 'ai-capability-message.v1',
        type: 'background.active-snapshot.recovery.read',
      }));
    } catch {
      return false;
    }
    const recovered = contentCapabilityMessageSchema.safeParse(recoveryInput);
    if (
      !recovered.success
      || recovered.data.type !== 'content.snapshot.sealed'
      || recovered.data.sessionId !== message.sessionId
      || recovered.data.revision !== message.revision
      || recovered.data.sequence <= recovered.data.revision
    ) return false;

    const contentSender = {tabId, origin: NHI_CLOUD_ORIGIN, url: contentUrl};
    const startingSequence = recovered.data.sequence - recovered.data.revision;
    const started = controller.receive({
      schemaVersion: 'ai-capability-message.v1',
      type: 'content.data-session.started',
      sessionId: recovered.data.sessionId,
      revision: 1,
      sequence: startingSequence,
    }, contentSender);
    if (!started.accepted) return false;
    for (let revision = 2; revision <= recovered.data.revision; revision += 1) {
      const revised = controller.receive({
        schemaVersion: 'ai-capability-message.v1',
        type: 'content.data-session.revised',
        sessionId: recovered.data.sessionId,
        revision,
        sequence: startingSequence + revision - 1,
      }, contentSender);
      if (revised.accepted) continue;
      controller.closeTab(tabId);
      return false;
    }
    const sealed = controller.receive(recovered.data, contentSender);
    if (sealed.accepted) return true;
    controller.closeTab(tabId);
    return false;
  }

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const senderUrl = sender.url ?? sender.tab?.url;
    const routerSender = {
      ...(sender.tab?.id === undefined ? {} : { tabId: sender.tab.id }),
      ...(senderUrl === undefined
        ? {}
        : { url: senderUrl }),
      ...(sender.origin === undefined ? {} : { origin: sender.origin }),
    };
    if (contentCapabilityMessageSchema.safeParse(message).success) {
      sendResponse(controller.receive(message, routerSender));
      return true;
    }
    const parsedIframeMessage = iframeCapabilityMessageSchema.safeParse(message);
    if (!parsedIframeMessage.success) {
      sendResponse({accepted: false, reason: 'invalid-message'});
      return true;
    }
    void iframe.receive(parsedIframeMessage.data, routerSender).then(async (response) => {
      const recoverableMessage = parsedIframeMessage.data.type === 'iframe.summary.review'
        || parsedIframeMessage.data.type === 'iframe.summary.copy'
        ? parsedIframeMessage.data
        : null;
      const mayRecover =
        recoverableMessage !== null
        && typeof response === 'object'
        && response !== null
        && Reflect.get(response, 'accepted') === false
        && Reflect.get(response, 'reason') === 'scope-mismatch';
      if (!mayRecover) {
        sendResponse(response);
        return;
      }
      const recovered = await recoverCurrentSnapshot(recoverableMessage, sender);
      sendResponse(recovered
        ? await iframe.receive(parsedIframeMessage.data, routerSender)
        : response);
    }, () => {
      sendResponse({accepted: false, reason: 'invalid-message'});
    });
    return true;
  });

  chromeApi.tabs.onRemoved.addListener((tabId) => {
    controller.closeTab(tabId);
  });

  return Object.freeze({
    activeScopeForTab: controller.activeScopeForTab,
  });
}
