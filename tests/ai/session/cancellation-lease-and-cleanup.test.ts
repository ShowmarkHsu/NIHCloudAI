import { describe, expect, it, vi } from 'vitest';

import {
  createCancellationLeaseRegistry,
  type CleanupEvent,
} from '../../../src/ai/session/lease';

const firstScope = {
  tabId: 17,
  sessionId: 'ds_cleanup_first_0001',
  revision: 1,
} as const;

const secondScope = {
  tabId: 17,
  sessionId: 'ds_cleanup_second_0001',
  revision: 2,
} as const;

const otherTabScope = {
  tabId: 29,
  sessionId: 'ds_cleanup_other_tab_0001',
  revision: 1,
} as const;

function registry(now = 10_000) {
  const clock = { now: vi.fn(() => now) };
  const cleanups: CleanupEvent[] = [];
  const leases = createCancellationLeaseRegistry({
    clock,
    leaseDurationMs: 1_000,
    onCleanup(event) {
      cleanups.push(event);
    },
  });

  return { clock, cleanups, leases };
}

describe('cancellation lease and tab/session/revision cleanup', () => {
  it('cancels every tracked revision for a closed tab without touching another tab', () => {
    const { cleanups, leases } = registry();
    leases.track(firstScope);
    leases.track(secondScope);
    leases.track(otherTabScope);

    expect(leases.cleanupClosedTab(17)).toEqual([firstScope, secondScope]);
    expect(cleanups).toEqual([
      { reason: 'tab-closed', scope: firstScope },
      { reason: 'tab-closed', scope: secondScope },
    ]);
    expect(leases.activeScopes()).toEqual([otherTabScope]);
  });

  it('expires only leases whose deadline has elapsed and emits each cleanup once', () => {
    const { clock, cleanups, leases } = registry();
    leases.track(firstScope);
    clock.now.mockReturnValue(10_999);
    expect(leases.cleanupExpired()).toEqual([]);

    clock.now.mockReturnValue(11_000);
    expect(leases.cleanupExpired()).toEqual([firstScope]);
    expect(leases.cleanupExpired()).toEqual([]);
    expect(cleanups).toEqual([{ reason: 'lease-expired', scope: firstScope }]);
  });

  it('purges restored scoped data after a service-worker restart without receiving a Provider key', () => {
    const { cleanups, leases } = registry();

    expect(leases.cleanupAfterServiceWorkerRestart([firstScope, otherTabScope])).toEqual([
      firstScope,
      otherTabScope,
    ]);
    expect(cleanups).toEqual([
      { reason: 'service-worker-restarted', scope: firstScope },
      { reason: 'service-worker-restarted', scope: otherTabScope },
    ]);
    expect(leases.activeScopes()).toEqual([]);
  });
});
