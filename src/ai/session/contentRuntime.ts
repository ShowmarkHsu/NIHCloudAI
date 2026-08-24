import {
  NHI_CLOUD_ORIGIN,
  createClosedDataSessionLifecycle,
} from './closedDataSessionLifecycle';
import {
  createLabVerticalSlice,
  terminalLabResultFromFetchEvent,
  type LabVerticalSliceResult,
} from '../integration/labVerticalSlice';
import { CLINICAL_PROJECTION_CONTRACT_VERSION } from '../contracts/clinicalProjection';
import {
  contentCapabilityMessageSchema,
  type ContentCapabilityMessage,
} from '../contracts/messages';

type LifecycleEvent = Readonly<{ detail?: unknown }>;
type SnapshotMessage = Extract<ContentCapabilityMessage, {type: 'content.snapshot.sealed'}>;

export type LabSnapshotPresentation = Readonly<{
  status: 'sealed';
  sessionId: string;
  revision: number;
  contractVersion: typeof CLINICAL_PROJECTION_CONTRACT_VERSION;
  coverage: LabVerticalSliceResult['sealed']['snapshot']['coverage'];
  sourceAliases: LabVerticalSliceResult['sourceAliases'];
}>;

export type ContentDataSessionRuntimeConfiguration = Readonly<{
  origin: string;
  send: (message: unknown) => Promise<unknown> | unknown;
  newSessionId: () => string;
  newPatientId?: () => string;
  now?: () => string;
  issueSourceReference?: () => unknown;
  onLabSnapshotSealed?: (presentation: LabSnapshotPresentation) => void;
  onLabSnapshotInvalidated?: () => void;
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
  let activeSnapshotMessage: SnapshotMessage | null = null;
  const patientIdBySession = new Map<string, string>();
  const labs = createLabVerticalSlice({
    now: configuration.now ?? (() => { throw new Error('R1 runtime requires a clock'); }),
    issueSourceReference: configuration.issueSourceReference ?? (() => { throw new Error('R1 runtime requires a source-reference issuer'); }),
  });
  const lifecycle = createClosedDataSessionLifecycle({
    tabId: 0,
    origin: configuration.origin,
    send: configuration.send,
  });

  const onDataFetchCompleted = (event: LifecycleEvent): void => {
    const switching = typeof event.detail === 'object' && event.detail !== null &&
      Reflect.get(event.detail, 'switching') === true;
    if (switching) {
      if (lifecycle.activeScope() !== null) {
        activeSnapshotMessage = null;
        configuration.onLabSnapshotInvalidated?.();
        lifecycle.logout(++sequence);
      }
      return;
    }
    const terminalLab = terminalLabResultFromFetchEvent(event.detail);
    if (terminalLab === null) return;
    const active = lifecycle.activeScope();
    if (active !== null) {
      activeSnapshotMessage = null;
      configuration.onLabSnapshotInvalidated?.();
    }
    const scope = active === null
      ? lifecycle.start(configuration.newSessionId(), ++sequence)
      : lifecycle.advanceRevision(++sequence);
    if (scope === null) return;
    const patientId = patientIdBySession.get(scope.sessionId) ?? configuration.newPatientId?.();
    if (patientId === undefined) return;
    patientIdBySession.set(scope.sessionId, patientId);
    const result = labs.ingest({patientId, sessionId: scope.sessionId, revision: scope.revision}, terminalLab);
    if (result === null) return;
    const parsedSnapshotMessage = contentCapabilityMessageSchema.parse({
      schemaVersion: 'ai-capability-message.v1',
      type: 'content.snapshot.sealed',
      sessionId: scope.sessionId,
      revision: scope.revision,
      sequence: ++sequence,
      snapshot: result.sealed.snapshot,
    });
    if (parsedSnapshotMessage.type !== 'content.snapshot.sealed') return;
    const snapshotMessage = parsedSnapshotMessage;
    activeSnapshotMessage = snapshotMessage;
    void Promise.resolve(configuration.send(snapshotMessage)).then((response) => {
      if (response !== undefined && (typeof response !== 'object' || response === null || Reflect.get(response, 'accepted') !== true)) return;
      if (lifecycle.activeScope()?.sessionId !== scope.sessionId || lifecycle.activeScope()?.revision !== scope.revision) return;
      configuration.onLabSnapshotSealed?.(Object.freeze({
        status: 'sealed',
        sessionId: scope.sessionId,
        revision: scope.revision,
        contractVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
        coverage: result.sealed.snapshot.coverage,
        sourceAliases: result.sourceAliases,
      }));
    }).catch(() => undefined);
  };
  const onPageHide = (): void => {
    const scope = lifecycle.activeScope();
    if (scope !== null) {
      activeSnapshotMessage = null;
      labs.discardSession(scope.sessionId);
      patientIdBySession.delete(scope.sessionId);
      configuration.onLabSnapshotInvalidated?.();
    }
    lifecycle.closeTab(++sequence);
  };

  configuration.addEventListener('dataFetchCompleted', onDataFetchCompleted);
  configuration.addEventListener('pagehide', onPageHide);

  return Object.freeze({
    activeSnapshotRecoveryMessage(): SnapshotMessage | null {
      const active = lifecycle.activeScope();
      if (
        active === null
        || activeSnapshotMessage === null
        || active.sessionId !== activeSnapshotMessage.sessionId
        || active.revision !== activeSnapshotMessage.revision
      ) return null;
      const recovered = contentCapabilityMessageSchema.parse({
        ...activeSnapshotMessage,
        sequence: ++sequence,
      });
      if (recovered.type !== 'content.snapshot.sealed') return null;
      activeSnapshotMessage = recovered;
      return recovered;
    },

    dispose(): void {
      const scope = lifecycle.activeScope();
      if (scope !== null) {
        activeSnapshotMessage = null;
        labs.discardSession(scope.sessionId);
        patientIdBySession.delete(scope.sessionId);
        configuration.onLabSnapshotInvalidated?.();
      }
      lifecycle.closeTab(++sequence);
      configuration.removeEventListener('dataFetchCompleted', onDataFetchCompleted);
      configuration.removeEventListener('pagehide', onPageHide);
    },
  });
}
