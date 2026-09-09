import { z } from 'zod';

import {
  clinicalProjectionV1Schema,
  phaseOneSourceRecordSchema,
} from './clinicalProjection';
import { snapshotCoverageSchema } from './coverage';
import {
  clinicalProjectionContractVersionSchema,
  patientDisplayIdentitySchemaVersionSchema,
  patientSnapshotSchemaVersionSchema,
} from './versions';

const localDateSchema = z.string().date();

export const patientDisplayIdentityV1Schema = z
  .object({
    schemaVersion: patientDisplayIdentitySchemaVersionSchema,
    displayName: z.string().min(1).max(128),
    nationalId: z.string().min(1).max(32).nullable(),
    birthDate: localDateSchema.nullable(),
    medicalRecordNumber: z.string().min(1).max(64).nullable(),
    cardNumber: z.string().min(1).max(64).nullable(),
  })
  .strict()
  .readonly();

export const opaquePatientIdSchema = z
  .string()
  .max(128)
  .regex(/^pt_[A-Za-z0-9_-]{16,125}$/)
  .brand<'OpaquePatientId'>();

export const dataSessionIdSchema = z
  .string()
  .max(128)
  .regex(/^ds_[A-Za-z0-9_-]{16,125}$/)
  .brand<'DataSessionId'>();

export const snapshotRevisionSchema = z
  .number()
  .int()
  .positive()
  .brand<'SnapshotRevision'>();

const patientSnapshotV1ObjectSchema = z
  .object({
    schemaVersion: patientSnapshotSchemaVersionSchema,
    contractVersion: clinicalProjectionContractVersionSchema,
    patientId: opaquePatientIdSchema,
    sessionId: dataSessionIdSchema,
    revision: snapshotRevisionSchema,
    capturedAt: z.string().datetime({ offset: true }),
    records: z.array(phaseOneSourceRecordSchema).max(5_000).readonly(),
    coverage: snapshotCoverageSchema,
  })
  .strict();

export const patientSnapshotV1Schema = patientSnapshotV1ObjectSchema
  .superRefine((snapshot, context) => {
    const projectionResult = clinicalProjectionV1Schema.safeParse({
      contractVersion: snapshot.contractVersion,
      records: snapshot.records,
      coverage: snapshot.coverage,
    });

    if (!projectionResult.success) {
      for (const issue of projectionResult.error.issues) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: issue.path,
        });
      }
    }
  })
  .readonly();

export type PatientDisplayIdentityV1 = z.infer<
  typeof patientDisplayIdentityV1Schema
>;
export type OpaquePatientId = z.infer<typeof opaquePatientIdSchema>;
export type DataSessionId = z.infer<typeof dataSessionIdSchema>;
export type SnapshotRevision = z.infer<typeof snapshotRevisionSchema>;
export type PatientSnapshotV1 = z.infer<typeof patientSnapshotV1Schema>;
