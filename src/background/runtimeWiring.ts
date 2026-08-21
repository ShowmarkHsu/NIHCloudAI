import {
  createClosedBackgroundDataSessionController,
} from './closedDataSessionController';
import { createSealedSnapshotStore } from './sealedSnapshotStore';

type ChromeMessageSender = Readonly<{
  tab?: Readonly<{ id?: number; url?: string }>;
  origin?: string;
  url?: string;
}>;

type ChromeRuntimeEvents = Readonly<{
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

export type ClosedBackgroundRuntimeChrome = Readonly<{
  runtime: ChromeRuntimeEvents;
  tabs: ChromeTabEvents;
}>;

/**
 * Installs the closed lifecycle at the actual MV3 event seams. Chrome supplies
 * the sender tab and origin; callers can neither select a target tab nor pass
 * a URL through a message. This deliberately owns no legacy action messages.
 */
export function installClosedBackgroundRuntime(chromeApi: ClosedBackgroundRuntimeChrome) {
  const snapshots = createSealedSnapshotStore();
  const controller = createClosedBackgroundDataSessionController({
    storeSnapshot(scope, snapshot) {
      return snapshots.put(scope, snapshot);
    },
    cancel(scope) {
      snapshots.discard(scope);
    },
  });

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const senderUrl = sender.url ?? sender.tab?.url;
    const routerSender = {
      ...(sender.tab?.id === undefined ? {} : { tabId: sender.tab.id }),
      ...(senderUrl === undefined
        ? {}
        : { url: senderUrl }),
      ...(sender.origin === undefined ? {} : { origin: sender.origin }),
    };
    const result = controller.receive(message, routerSender);
    sendResponse(result);
    return true;
  });

  chromeApi.tabs.onRemoved.addListener((tabId) => {
    controller.closeTab(tabId);
  });

  return Object.freeze({
    activeScopeForTab: controller.activeScopeForTab,
  });
}
