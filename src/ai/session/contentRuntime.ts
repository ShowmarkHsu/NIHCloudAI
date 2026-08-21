import {
  NHI_CLOUD_ORIGIN,
  createClosedDataSessionLifecycle,
} from './closedDataSessionLifecycle';

type LifecycleEvent = Readonly<{ detail?: Readonly<{ switching?: boolean }> }>;

export type ContentDataSessionRuntimeConfiguration = Readonly<{
  origin: string;
  send: (message: unknown) => void;
  newSessionId: () => string;
  addEventListener: (type: 'dataFetchCompleted' | 'pagehide', listener: (event: LifecycleEvent) => void) => void;
  removeEventListener: (type: 'dataFetchCompleted' | 'pagehide', listener: (event: LifecycleEvent) => void) => void;
}>;

/**
 * Bridges only two existing content-side terminal events to the closed
 * lifecycle. It neither reads raw data nor declares it a sealed snapshot;
 * summary enablement remains fail-closed until an approved projection exists.
 */
export function installContentDataSessionRuntime(configuration: ContentDataSessionRuntimeConfiguration) {
  if (configuration.origin !== NHI_CLOUD_ORIGIN) {
    throw new RangeError('content runtime is limited to the fixed NHI Cloud origin');
  }
  let sequence = 0;
  const lifecycle = createClosedDataSessionLifecycle({
    tabId: 0,
    origin: configuration.origin,
    send: configuration.send,
  });

  const onDataFetchCompleted = (event: LifecycleEvent): void => {
    if (event.detail?.switching === true) {
      if (lifecycle.activeScope() !== null) lifecycle.logout(++sequence);
      return;
    }
    if (lifecycle.activeScope() === null) {
      lifecycle.start(configuration.newSessionId(), ++sequence);
    }
  };
  const onPageHide = (): void => {
    lifecycle.closeTab(++sequence);
  };

  configuration.addEventListener('dataFetchCompleted', onDataFetchCompleted);
  configuration.addEventListener('pagehide', onPageHide);

  return Object.freeze({
    dispose(): void {
      lifecycle.closeTab(++sequence);
      configuration.removeEventListener('dataFetchCompleted', onDataFetchCompleted);
      configuration.removeEventListener('pagehide', onPageHide);
    },
  });
}
