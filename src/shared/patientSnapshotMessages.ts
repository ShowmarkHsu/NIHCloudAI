import type { PatientSnapshot, SourceRecordType } from "../domain";

export const STORE_PATIENT_SNAPSHOT = "STORE_PATIENT_SNAPSHOT" as const;
export const CLEAR_PATIENT_SNAPSHOT = "CLEAR_PATIENT_SNAPSHOT" as const;
export const GET_PATIENT_SNAPSHOT_STATUS = "GET_PATIENT_SNAPSHOT_STATUS" as const;

export type SnapshotDiagnostic = Readonly<{
  source: SourceRecordType;
  level: "info" | "warning";
  message: string;
}>;

export type StorePatientSnapshotMessage = Readonly<{
  type: typeof STORE_PATIENT_SNAPSHOT;
  snapshot: PatientSnapshot;
  diagnostics: readonly SnapshotDiagnostic[];
}>;

export type ClearPatientSnapshotMessage = Readonly<{
  type: typeof CLEAR_PATIENT_SNAPSHOT;
  sessionId: string;
  reason: "patient-switch" | "logout" | "authorization-expired" | "page-unload";
}>;

export type GetPatientSnapshotStatusMessage = Readonly<{
  type: typeof GET_PATIENT_SNAPSHOT_STATUS;
}>;

export type PatientSnapshotStatus = Readonly<{
  available: boolean;
  sessionId?: string;
  capturedAt?: string;
  recordCounts?: Partial<Record<SourceRecordType, number>>;
  warningCount?: number;
}>;

export type PatientSnapshotMessage =
  | StorePatientSnapshotMessage
  | ClearPatientSnapshotMessage
  | GetPatientSnapshotStatusMessage;

export type PatientSnapshotMessageResponse =
  | Readonly<{ ok: true; status: PatientSnapshotStatus }>
  | Readonly<{ ok: false; error: string }>;
