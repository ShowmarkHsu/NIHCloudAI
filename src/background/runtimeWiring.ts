import {
  createClosedBackgroundDataSessionController,
} from './closedDataSessionController';
import { createClosedBackgroundMessageRouter } from './aiMessageRouter';
import { createIframeSummaryBroker } from './iframeSummaryBroker';
import { createSealedSnapshotStore } from './sealedSnapshotStore';
import { createBackgroundProviderBoundary, type SummaryProvider } from '../ai/providers/backgroundProviderBoundary';
import { contentCapabilityMessageSchema, iframeCapabilityMessageSchema } from '../ai/contracts/messages';

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
    fetch: globalThis.fetch,
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
    if (!iframeCapabilityMessageSchema.safeParse(message).success) {
      sendResponse({accepted: false, reason: 'invalid-message'});
      return true;
    }
    void iframe.receive(message, routerSender).then(sendResponse, () => {
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
