import {
  contentCapabilityMessageSchema,
  type ContentCapabilityMessage,
} from '../ai/contracts/messages';
import {
  NHI_CLOUD_ORIGIN,
  type DataSessionEndReason,
} from '../ai/session/closedDataSessionLifecycle';
import {
  createTabScopedRevisionCoordinator,
  type RevisionScope,
} from '../ai/session/coordinator';
import type { RouterSender } from './aiMessageRouter';

type LifecycleMessage = Extract<
  ContentCapabilityMessage,
  | { type: 'content.data-session.started' }
  | { type: 'content.data-session.revised' }
  | { type: 'content.data-session.ended' }
  | { type: 'content.snapshot.sealed' }
>;

type Result =
  | Readonly<{ accepted: true }>
  | Readonly<{
      accepted: false;
      reason: 'invalid-message' | 'sender-url-mismatch' | 'sender-origin-mismatch' | 'sender-tab-mismatch' | 'scope-mismatch' | 'sequence-rollback';
    }>;

export type ClosedBackgroundDataSessionControllerConfiguration = Readonly<{
  cancel?: (scope: RevisionScope, reason: DataSessionEndReason) => void;
  storeSnapshot?: (scope: RevisionScope, snapshot: Extract<ContentCapabilityMessage, { type: 'content.snapshot.sealed' }>['snapshot']) => boolean;
}>;

function rejected(reason: Exclude<Result, { accepted: true }>['reason']): Result {
  return { accepted: false, reason };
}

function senderIsFixedNhiContent(sender: RouterSender): Result | null {
  if (!Number.isSafeInteger(sender.tabId) || sender.tabId === undefined || sender.tabId < 0) {
    return rejected('sender-tab-mismatch');
  }
  if (sender.origin !== NHI_CLOUD_ORIGIN) return rejected('sender-origin-mismatch');
  try {
    if (sender.url === undefined || new URL(sender.url).origin !== NHI_CLOUD_ORIGIN) {
      return rejected('sender-url-mismatch');
    }
  } catch {
    return rejected('sender-url-mismatch');
  }
  return null;
}

function lifecycleMessage(message: unknown): LifecycleMessage | null {
  const parsed = contentCapabilityMessageSchema.safeParse(message);
  if (!parsed.success) return null;
  return parsed.data.type === 'content.data-session.started' || parsed.data.type === 'content.data-session.revised' || parsed.data.type === 'content.data-session.ended' || parsed.data.type === 'content.snapshot.sealed'
    ? parsed.data
    : null;
}

/**
 * Background-only counterpart to the fixed-origin content lifecycle. It never
 * accepts commands, URLs, or executable code; the browser sender supplies the
 * tab binding and every operation is scoped to that tab/session/revision.
 */
export function createClosedBackgroundDataSessionController(
  configuration: ClosedBackgroundDataSessionControllerConfiguration = {},
) {
  const coordinator = createTabScopedRevisionCoordinator();
  const lastSequenceByScope = new Map<string, number>();

  function key(scope: RevisionScope): string {
    return JSON.stringify([scope.tabId, scope.sessionId, scope.revision]);
  }

  function sequenceIsCurrent(scope: RevisionScope, sequence: number): boolean {
    const previous = lastSequenceByScope.get(key(scope));
    if (previous !== undefined && sequence <= previous) return false;
    lastSequenceByScope.set(key(scope), sequence);
    return true;
  }

  function cancel(scope: RevisionScope, reason: DataSessionEndReason): void {
    configuration.cancel?.(scope, reason);
    lastSequenceByScope.delete(key(scope));
  }

  return Object.freeze({
    receive(message: unknown, sender: RouterSender): Result {
      const parsed = lifecycleMessage(message);
      if (parsed === null) return rejected('invalid-message');
      const senderRejection = senderIsFixedNhiContent(sender);
      if (senderRejection !== null) return senderRejection;
      const tabId = sender.tabId!;

      if (parsed.type === 'content.data-session.started') {
        if (parsed.revision !== 1) return rejected('scope-mismatch');
        const active = coordinator.activeScopeForTab(tabId);
        if (active !== null) {
          if (active.sessionId === parsed.sessionId) return rejected('scope-mismatch');
          cancel(active, 'patient-changed');
        }
        const scope = coordinator.startSession(tabId, parsed.sessionId);
        return sequenceIsCurrent(scope, parsed.sequence)
          ? { accepted: true }
          : rejected('sequence-rollback');
      }

      const scope = coordinator.activeScopeForTab(tabId);
      if (
        scope === null
        || scope.sessionId !== parsed.sessionId
        || (parsed.type === 'content.data-session.revised'
          ? parsed.revision !== scope.revision + 1
          : scope.revision !== parsed.revision)
      ) {
        return rejected('scope-mismatch');
      }
      if (!sequenceIsCurrent(scope, parsed.sequence)) return rejected('sequence-rollback');
      if (parsed.type === 'content.data-session.revised') {
        const next = coordinator.startNextRevision(scope);
        if (next === null || next.revision !== parsed.revision) return rejected('scope-mismatch');
        return { accepted: true };
      }
      if (parsed.type === 'content.snapshot.sealed') {
        return configuration.storeSnapshot?.(scope, parsed.snapshot) === true
          ? { accepted: true }
          : rejected('scope-mismatch');
      }
      cancel(scope, 'logout');
      coordinator.closeTab(tabId);
      return { accepted: true };
    },

    closeTab(tabId: number): boolean {
      const scope = coordinator.activeScopeForTab(tabId);
      if (scope === null) return false;
      cancel(scope, 'tab-closed');
      return coordinator.closeTab(tabId);
    },

    activeScopeForTab(tabId: number): RevisionScope | null {
      return coordinator.activeScopeForTab(tabId);
    },
  });
}
