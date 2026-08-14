import { z } from 'zod';

export const CLINICAL_PROJECTION_CONTRACT_VERSION = 'clinical-projection.v1' as const;
export const PATIENT_SNAPSHOT_SCHEMA_VERSION = 'patient-snapshot.v1' as const;
export const PATIENT_DISPLAY_IDENTITY_SCHEMA_VERSION =
  'patient-display-identity.v1' as const;

export const clinicalProjectionContractVersionSchema = z.literal(
  CLINICAL_PROJECTION_CONTRACT_VERSION,
);

export const patientSnapshotSchemaVersionSchema = z.literal(
  PATIENT_SNAPSHOT_SCHEMA_VERSION,
);

export const patientDisplayIdentitySchemaVersionSchema = z.literal(
  PATIENT_DISPLAY_IDENTITY_SCHEMA_VERSION,
);

export type ClinicalProjectionContractVersion = z.infer<
  typeof clinicalProjectionContractVersionSchema
>;
export type PatientSnapshotSchemaVersion = z.infer<
  typeof patientSnapshotSchemaVersionSchema
>;
export type PatientDisplayIdentitySchemaVersion = z.infer<
  typeof patientDisplayIdentitySchemaVersionSchema
>;
