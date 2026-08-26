import { z } from 'zod';

export const CLINICAL_PROJECTION_CONTRACT_VERSION = 'clinical-projection.v1' as const;
export const PATIENT_SNAPSHOT_SCHEMA_VERSION = 'patient-snapshot.v1' as const;
export const PATIENT_DISPLAY_IDENTITY_SCHEMA_VERSION =
  'patient-display-identity.v1' as const;
export const CAPABILITY_MESSAGE_SCHEMA_VERSION =
  'ai-capability-message.v1' as const;
export const RELEASE_MANIFEST_SCHEMA_VERSION = 'release-manifest.v1' as const;
export const CLINICAL_SUMMARY_PROMPT_VERSION =
  'clinical-summary-prompt.v5' as const;
export const CLINICAL_SUMMARY_SCHEMA_VERSION = 'clinical-summary.v1' as const;
export const CLINICAL_RULES_VERSION = 'clinical-rules.v3' as const;
export const CLINICAL_CASE_SET_VERSION = 'clinical-case-set.v1' as const;

export const clinicalProjectionContractVersionSchema = z.literal(
  CLINICAL_PROJECTION_CONTRACT_VERSION,
);

export const patientSnapshotSchemaVersionSchema = z.literal(
  PATIENT_SNAPSHOT_SCHEMA_VERSION,
);

export const patientDisplayIdentitySchemaVersionSchema = z.literal(
  PATIENT_DISPLAY_IDENTITY_SCHEMA_VERSION,
);

export const capabilityMessageSchemaVersionSchema = z.literal(
  CAPABILITY_MESSAGE_SCHEMA_VERSION,
);

export const releaseManifestSchemaVersionSchema = z.literal(
  RELEASE_MANIFEST_SCHEMA_VERSION,
);

export const clinicalSummaryPromptVersionSchema = z.literal(
  CLINICAL_SUMMARY_PROMPT_VERSION,
);

export const clinicalSummarySchemaVersionSchema = z.literal(
  CLINICAL_SUMMARY_SCHEMA_VERSION,
);

export const clinicalRulesVersionSchema = z.literal(CLINICAL_RULES_VERSION);

export const clinicalCaseSetVersionSchema = z.literal(
  CLINICAL_CASE_SET_VERSION,
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
export type CapabilityMessageSchemaVersion = z.infer<
  typeof capabilityMessageSchemaVersionSchema
>;
export type ReleaseManifestSchemaVersion = z.infer<
  typeof releaseManifestSchemaVersionSchema
>;
export type ClinicalSummaryPromptVersion = z.infer<
  typeof clinicalSummaryPromptVersionSchema
>;
export type ClinicalSummarySchemaVersion = z.infer<
  typeof clinicalSummarySchemaVersionSchema
>;
export type ClinicalRulesVersion = z.infer<typeof clinicalRulesVersionSchema>;
export type ClinicalCaseSetVersion = z.infer<
  typeof clinicalCaseSetVersionSchema
>;
