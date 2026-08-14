import {
  dataSessionIdSchema,
  snapshotRevisionSchema,
} from '../contracts/patientSnapshot';
import type { RevisionScope } from './coordinator';

export type CleanupReason = 'tab-closed' | 'lease-expired' | 'service-worker-restarted';

export type CleanupEvent = Readonly<{
  reason: CleanupReason;
  scope: RevisionScope;
}>;

type Clock = Readonly<{
  now: () => number;
}>;

type CancellationLeaseConfiguration = Readonly<{
  clock: Clock;
  leaseDurationMs: number;
  onCleanup: (event: CleanupEvent) => void;
}>;

type Lease = Readonly<{
  scope: RevisionScope;
  expiresAt: number;
}>;

function assertScope(scope: RevisionScope): void {
  if (!Number.isSafeInteger(scope.tabId) || scope.tabId < 0) {
    throw new RangeError('tabId must be a non-negative safe integer');
  }
  if (!dataSessionIdSchema.safeParse(scope.sessionId).success) {
    throw new RangeError('sessionId must be a valid opaque data session id');
  }
  if (!snapshotRevisionSchema.safeParse(scope.revision).success) {
    throw new RangeError('revision must be a positive safe integer');
  }
}

function assertConfiguration(configuration: CancellationLeaseConfiguration): void {
  if (!Number.isSafeInteger(configuration.leaseDurationMs) || configuration.leaseDurationMs <= 0) {
    throw new RangeError('leaseDurationMs must be a positive safe integer');
  }
}

function scopeKey(scope: RevisionScope): string {
  return JSON.stringify([scope.tabId, scope.sessionId, scope.revision]);
}

function immutableScope(scope: RevisionScope): RevisionScope {
  return Object.freeze({
    tabId: scope.tabId,
    sessionId: scope.sessionId,
    revision: scope.revision,
  });
}

/**
 * Tracks only cancellable patient-derived work. Provider session keys never
 * enter this API, so tab/session/revision cleanup cannot delete them.
 */
export function createCancellationLeaseRegistry(configuration: CancellationLeaseConfiguration) {
  assertConfiguration(configuration);
  const leases = new Map<string, Lease>();

  function cleanup(scope: RevisionScope, reason: CleanupReason): RevisionScope {
    const immutable = immutableScope(scope);
    configuration.onCleanup(Object.freeze({ reason, scope: immutable }));
    return immutable;
  }

  function removeScopes(scopes: readonly RevisionScope[], reason: CleanupReason): RevisionScope[] {
    const cleaned: RevisionScope[] = [];
    for (const scope of scopes) {
      const key = scopeKey(scope);
      if (!leases.delete(key)) continue;
      cleaned.push(cleanup(scope, reason));
    }
    return cleaned;
  }

  return Object.freeze({
    track(scope: RevisionScope): void {
      assertScope(scope);
      const now = configuration.clock.now();
      if (!Number.isSafeInteger(now)) {
        throw new RangeError('clock now must be a safe integer');
      }

      const expiresAt = now + configuration.leaseDurationMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new RangeError('lease expiry exceeds the safe integer range');
      }
      const immutable = immutableScope(scope);
      leases.set(scopeKey(immutable), Object.freeze({ scope: immutable, expiresAt }));
    },

    cleanupClosedTab(tabId: number): RevisionScope[] {
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        throw new RangeError('tabId must be a non-negative safe integer');
      }
      return removeScopes(
        [...leases.values()].filter((lease) => lease.scope.tabId === tabId).map((lease) => lease.scope),
        'tab-closed',
      );
    },

    cleanupExpired(): RevisionScope[] {
      const now = configuration.clock.now();
      if (!Number.isSafeInteger(now)) {
        throw new RangeError('clock now must be a safe integer');
      }
      return removeScopes(
        [...leases.values()]
          .filter((lease) => lease.expiresAt <= now)
          .map((lease) => lease.scope),
        'lease-expired',
      );
    },

    cleanupAfterServiceWorkerRestart(restoredScopes: readonly RevisionScope[]): RevisionScope[] {
      const uniqueScopes = new Map<string, RevisionScope>();
      for (const scope of restoredScopes) {
        assertScope(scope);
        uniqueScopes.set(scopeKey(scope), scope);
      }
      for (const scope of uniqueScopes.values()) {
        leases.delete(scopeKey(scope));
      }
      return [...uniqueScopes.values()].map((scope) => cleanup(scope, 'service-worker-restarted'));
    },

    activeScopes(): RevisionScope[] {
      return [...leases.values()].map((lease) => immutableScope(lease.scope));
    },
  });
}
