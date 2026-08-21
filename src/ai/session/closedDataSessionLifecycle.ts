import {
  contentCapabilityMessageSchema,
  type ContentCapabilityMessage,
} from '../contracts/messages';
import {
  createTabScopedRevisionCoordinator,
  type RevisionScope,
} from './coordinator';

export const NHI_CLOUD_ORIGIN = 'https://medcloud2.nhi.gov.tw' as const;

export type DataSessionEndReason = 'patient-changed' | 'logout' | 'tab-closed';

type LifecycleMessage = Extract<
  ContentCapabilityMessage,
  | { type: 'content.data-session.started' }
  | { type: 'content.data-session.revised' }
  | { type: 'content.data-session.ended' }
>;

export type ClosedDataSessionLifecycleConfiguration = Readonly<{
  tabId: number;
  origin: string;
  send: (message: LifecycleMessage) => void;
  cancel?: (scope: RevisionScope, reason: DataSessionEndReason) => void;
}>;

function assertFixedOrigin(origin: string): void {
  if (origin !== NHI_CLOUD_ORIGIN) {
    throw new RangeError('data-session lifecycle is limited to the NHI Cloud origin');
  }
}

function message(
  type: LifecycleMessage['type'],
  scope: RevisionScope,
  sequence: number,
): LifecycleMessage {
  const parsed = contentCapabilityMessageSchema.parse({
    schemaVersion: 'ai-capability-message.v1',
    type,
    sessionId: scope.sessionId,
    revision: scope.revision,
    sequence,
  });
  if (parsed.type !== type) {
    throw new TypeError('closed data-session lifecycle emitted an unexpected capability');
  }
  return Object.freeze(parsed);
}

/**
 * Content-side lifecycle authority. It has no URL, code, RPC, snapshot, or
 * provider inputs: the only outbound values are closed capability messages for
 * the fixed NHI origin and this browser tab.
 */
export function createClosedDataSessionLifecycle(
  configuration: ClosedDataSessionLifecycleConfiguration,
) {
  assertFixedOrigin(configuration.origin);
  const coordinator = createTabScopedRevisionCoordinator();

  function end(sequence: number, reason: DataSessionEndReason): boolean {
    const scope = coordinator.activeScopeForTab(configuration.tabId);
    if (scope === null) return false;

    configuration.cancel?.(scope, reason);
    configuration.send(message('content.data-session.ended', scope, sequence));
    coordinator.closeTab(configuration.tabId);
    return true;
  }

  return Object.freeze({
    start(sessionId: string, sequence: number): RevisionScope {
      if (coordinator.activeScopeForTab(configuration.tabId) !== null) {
        throw new RangeError('an active data session must be ended or replaced first');
      }
      const scope = coordinator.startSession(configuration.tabId, sessionId);
      configuration.send(message('content.data-session.started', scope, sequence));
      return scope;
    },

    replacePatient(sessionId: string, sequence: number): RevisionScope {
      end(sequence, 'patient-changed');
      return this.start(sessionId, sequence + 1);
    },

    advanceRevision(sequence: number): RevisionScope | null {
      const current = coordinator.activeScopeForTab(configuration.tabId);
      if (current === null) return null;
      const next = coordinator.startNextRevision(current);
      if (next === null) return null;
      configuration.send(message('content.data-session.revised', next, sequence));
      return next;
    },

    logout(sequence: number): boolean {
      return end(sequence, 'logout');
    },

    closeTab(sequence: number): boolean {
      return end(sequence, 'tab-closed');
    },

    activeScope(): RevisionScope | null {
      return coordinator.activeScopeForTab(configuration.tabId);
    },
  });
}
