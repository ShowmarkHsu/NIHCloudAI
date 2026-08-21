import {
  patientSnapshotV1Schema,
  type PatientSnapshotV1,
} from '../ai/contracts/patientSnapshot';
import type { RevisionScope } from '../ai/session/coordinator';

function sameScope(scope: RevisionScope, snapshot: PatientSnapshotV1): boolean {
  return scope.sessionId === snapshot.sessionId && scope.revision === snapshot.revision;
}

/** In-memory background vault for the currently accepted sealed revision only. */
export function createSealedSnapshotStore() {
  const snapshotsByTab = new Map<number, PatientSnapshotV1>();

  return Object.freeze({
    put(scope: RevisionScope, snapshotInput: unknown): boolean {
      const parsed = patientSnapshotV1Schema.safeParse(snapshotInput);
      if (!parsed.success || !sameScope(scope, parsed.data)) return false;
      snapshotsByTab.set(scope.tabId, parsed.data);
      return true;
    },

    active(scope: RevisionScope): PatientSnapshotV1 | null {
      const snapshot = snapshotsByTab.get(scope.tabId);
      return snapshot !== undefined && sameScope(scope, snapshot) ? snapshot : null;
    },

    discard(scope: RevisionScope): void {
      const snapshot = snapshotsByTab.get(scope.tabId);
      if (snapshot !== undefined && sameScope(scope, snapshot)) snapshotsByTab.delete(scope.tabId);
    },
  });
}
