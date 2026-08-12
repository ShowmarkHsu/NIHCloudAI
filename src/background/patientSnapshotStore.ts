import {
  PatientSnapshotSchema,
  type PatientSnapshot,
  type SourceRecordType,
} from "../domain";
import type {
  PatientSnapshotStatus,
  SnapshotDiagnostic,
} from "../shared/patientSnapshotMessages";

const ACTIVE_SNAPSHOT_KEY = "active-patient-snapshot";

export type ActivePatientSnapshot = Readonly<{
  snapshot: PatientSnapshot;
  diagnostics: readonly SnapshotDiagnostic[];
  sourceTabId?: number;
}>;

export type SnapshotSessionStoragePort = Pick<
  chrome.storage.StorageArea,
  "get" | "set" | "remove"
>;

export interface PatientSnapshotStore {
  save(
    snapshot: PatientSnapshot,
    diagnostics: readonly SnapshotDiagnostic[],
    sourceTabId?: number,
  ): Promise<PatientSnapshotStatus>;
  status(): Promise<PatientSnapshotStatus>;
  active(): Promise<ActivePatientSnapshot | undefined>;
  clear(sessionId: string): Promise<PatientSnapshotStatus>;
}

function countRecords(snapshot: PatientSnapshot) {
  const counts: Partial<Record<SourceRecordType, number>> = {};
  for (const record of snapshot.records) {
    counts[record.type] = (counts[record.type] ?? 0) + 1;
  }
  return counts;
}

function toStatus(stored: ActivePatientSnapshot | undefined): PatientSnapshotStatus {
  if (!stored) return { available: false };
  return {
    available: true,
    sessionId: stored.snapshot.sessionId,
    capturedAt: stored.snapshot.capturedAt,
    recordCounts: countRecords(stored.snapshot),
    warningCount: stored.diagnostics.filter((item) => item.level === "warning")
      .length,
  };
}

function isStoredSnapshot(value: unknown): value is ActivePatientSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    PatientSnapshotSchema.safeParse(candidate.snapshot).success &&
    Array.isArray(candidate.diagnostics) &&
    (candidate.sourceTabId === undefined ||
      typeof candidate.sourceTabId === "number")
  );
}

export function createPatientSnapshotStore(
  storage: SnapshotSessionStoragePort = chrome.storage.session,
): PatientSnapshotStore {
  async function load(): Promise<ActivePatientSnapshot | undefined> {
    const values = await storage.get(ACTIVE_SNAPSHOT_KEY);
    const value = values[ACTIVE_SNAPSHOT_KEY];
    return isStoredSnapshot(value) ? value : undefined;
  }

  return {
    async save(snapshotInput, diagnostics, sourceTabId) {
      const snapshot = PatientSnapshotSchema.parse(snapshotInput);
      const stored: ActivePatientSnapshot = {
        snapshot,
        diagnostics: [...diagnostics],
        sourceTabId,
      };
      await storage.set({ [ACTIVE_SNAPSHOT_KEY]: stored });
      return toStatus(stored);
    },

    async status() {
      return toStatus(await load());
    },

    active() {
      return load();
    },

    async clear(sessionId) {
      const current = await load();
      // A late clear from an aborted request must never remove the new patient.
      if (current?.snapshot.sessionId === sessionId) {
        await storage.remove(ACTIVE_SNAPSHOT_KEY);
        return { available: false };
      }
      return toStatus(current);
    },
  };
}
