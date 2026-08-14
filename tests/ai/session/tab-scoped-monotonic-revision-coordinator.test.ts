import { describe, expect, it } from 'vitest';

import {
  createTabScopedRevisionCoordinator,
  type RevisionScope,
} from '../../../src/ai/session/coordinator';

function scope(tabId: number, sessionId: string, revision: number): RevisionScope {
  return { tabId, sessionId, revision };
}

describe('tab-scoped monotonic revision coordinator', () => {
  it('starts at revision one and advances only the active tab session', () => {
    const coordinator = createTabScopedRevisionCoordinator();
    const first = coordinator.startSession(17, 'ds_session_alpha_0001');

    expect(first).toEqual(scope(17, 'ds_session_alpha_0001', 1));
    expect(Object.isFrozen(first)).toBe(true);
    expect(coordinator.isCurrent(first)).toBe(true);

    const next = coordinator.startNextRevision(first);
    expect(next).toEqual(scope(17, 'ds_session_alpha_0001', 2));
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(next!)).toBe(true);
    expect(coordinator.activeScopeForTab(17)).toEqual(next);
  });

  it('keeps same-numbered revisions isolated between tabs', () => {
    const coordinator = createTabScopedRevisionCoordinator();
    const firstTab = coordinator.startSession(17, 'ds_tab_one_session_0001');
    const secondTab = coordinator.startSession(29, 'ds_tab_two_session_0001');

    expect(firstTab.revision).toBe(secondTab.revision);
    expect(coordinator.isCurrent(firstTab)).toBe(true);
    expect(coordinator.isCurrent(secondTab)).toBe(true);

    const secondTabNext = coordinator.startNextRevision(secondTab);
    expect(coordinator.isCurrent(firstTab)).toBe(true);
    expect(coordinator.isCurrent(secondTab)).toBe(false);
    expect(coordinator.isCurrent(secondTabNext!)).toBe(true);
  });

  it('rejects a late result from a superseded revision', () => {
    const coordinator = createTabScopedRevisionCoordinator();
    const revisionOne = coordinator.startSession(17, 'ds_revision_race_0001');
    const revisionTwo = coordinator.startNextRevision(revisionOne);

    const delayedRevisionOneResult = scope(17, 'ds_revision_race_0001', 1);
    expect(coordinator.acceptCurrent(delayedRevisionOneResult)).toBe(false);
    expect(coordinator.acceptCurrent(revisionTwo!)).toBe(true);
  });

  it('rejects late work from a replaced patient session', () => {
    const coordinator = createTabScopedRevisionCoordinator();
    const previousPatient = coordinator.startSession(17, 'ds_previous_patient_0001');
    const currentPatient = coordinator.startSession(17, 'ds_current_patient_0001');

    expect(currentPatient).toEqual(scope(17, 'ds_current_patient_0001', 1));
    expect(coordinator.acceptCurrent(previousPatient)).toBe(false);
    expect(coordinator.acceptCurrent(currentPatient)).toBe(true);
    expect(coordinator.startNextRevision(previousPatient)).toBeNull();
  });

  it('rejects closed-tab work and never reactivates a retired session id', () => {
    const coordinator = createTabScopedRevisionCoordinator();
    const closedScope = coordinator.startSession(17, 'ds_closed_tab_session_0001');

    expect(coordinator.closeTab(17)).toBe(true);
    expect(coordinator.activeScopeForTab(17)).toBeNull();
    expect(coordinator.acceptCurrent(closedScope)).toBe(false);
    expect(() => coordinator.startSession(29, 'ds_closed_tab_session_0001')).toThrow(
      RangeError,
    );
  });

  it('rejects malformed scopes and does not advance when a stale scope retries', () => {
    const coordinator = createTabScopedRevisionCoordinator();
    const first = coordinator.startSession(17, 'ds_valid_session_000001');
    const current = coordinator.startNextRevision(first);

    expect(() => coordinator.startSession(-1, 'ds_another_session_0001')).toThrow(
      RangeError,
    );
    expect(() => coordinator.startSession(18, 'not-an-opaque-session')).toThrow(
      RangeError,
    );
    expect(coordinator.startNextRevision(first)).toBeNull();
    expect(coordinator.activeScopeForTab(17)).toEqual(current);
    expect(() => coordinator.isCurrent(scope(17, 'ds_valid_session_000001', 0))).toThrow(
      RangeError,
    );
  });
});
