import { dataSessionIdSchema, snapshotRevisionSchema } from '../contracts/patientSnapshot';

export type RevisionScope = Readonly<{
  tabId: number;
  sessionId: string;
  revision: number;
}>;

type ActiveSession = {
  sessionId: string;
  revision: number;
};

function assertTabId(tabId: number): void {
  if (!Number.isSafeInteger(tabId) || tabId < 0) {
    throw new RangeError('tabId must be a non-negative safe integer');
  }
}

function assertSessionId(sessionId: string): void {
  if (!dataSessionIdSchema.safeParse(sessionId).success) {
    throw new RangeError('sessionId must be a valid opaque data session id');
  }
}

function assertRevision(revision: number): void {
  if (!snapshotRevisionSchema.safeParse(revision).success) {
    throw new RangeError('revision must be a positive safe integer');
  }
}

function immutableScope(tabId: number, sessionId: string, revision: number): RevisionScope {
  return Object.freeze({tabId, sessionId, revision});
}

/**
 * Maintains the in-memory content-side authority for one active data session
 * per browser tab. It deliberately stores no patient identity, snapshot, raw
 * source data, provider state, or sequence state; those belong to later B4
 * boundaries. Revisions are monotonic within one data session; a replacement
 * patient session begins at revision one and invalidates the prior scope. A
 * caller may act on a result only when its exact scope remains current.
 */
export function createTabScopedRevisionCoordinator() {
  const activeSessions = new Map<number, ActiveSession>();
  const retiredSessionIds = new Set<string>();

  function isCurrent(scope: RevisionScope): boolean {
    assertTabId(scope.tabId);
    assertSessionId(scope.sessionId);
    assertRevision(scope.revision);

    const active = activeSessions.get(scope.tabId);
    return active?.sessionId === scope.sessionId && active.revision === scope.revision;
  }

  return Object.freeze({
    startSession(tabId: number, sessionId: string): RevisionScope {
      assertTabId(tabId);
      assertSessionId(sessionId);

      const active = activeSessions.get(tabId);
      if (active?.sessionId === sessionId || retiredSessionIds.has(sessionId)) {
        throw new RangeError('sessionId must not be reactivated');
      }

      if (active !== undefined) {
        retiredSessionIds.add(active.sessionId);
      }

      const revision = 1;
      activeSessions.set(tabId, {sessionId, revision});
      return immutableScope(tabId, sessionId, revision);
    },

    startNextRevision(scope: RevisionScope): RevisionScope | null {
      if (!isCurrent(scope)) {
        return null;
      }

      const revision = scope.revision + 1;
      if (!Number.isSafeInteger(revision)) {
        throw new RangeError('revision exceeds the safe integer range');
      }

      activeSessions.set(scope.tabId, {sessionId: scope.sessionId, revision});
      return immutableScope(scope.tabId, scope.sessionId, revision);
    },

    activeScopeForTab(tabId: number): RevisionScope | null {
      assertTabId(tabId);
      const active = activeSessions.get(tabId);
      return active === undefined
        ? null
        : immutableScope(tabId, active.sessionId, active.revision);
    },

    isCurrent,

    acceptCurrent(scope: RevisionScope): boolean {
      return isCurrent(scope);
    },

    closeTab(tabId: number): boolean {
      assertTabId(tabId);
      const active = activeSessions.get(tabId);
      if (active === undefined) {
        return false;
      }

      activeSessions.delete(tabId);
      retiredSessionIds.add(active.sessionId);
      return true;
    },
  });
}
