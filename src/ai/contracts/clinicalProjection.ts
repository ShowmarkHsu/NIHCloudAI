import { z } from 'zod';

import {
  PHASE_ONE_SOURCE_FAMILIES,
  snapshotCoverageSchema,
  type PhaseOneSourceFamily,
  type SnapshotCoverage,
} from './coverage';
import {
  CLINICAL_PROJECTION_CONTRACT_VERSION,
  clinicalProjectionContractVersionSchema,
} from './versions';

export const CLINICAL_CONTRACT_LIMITS = Object.freeze({
  boundedText: 256,
  code: 64,
  freeText: 8_000,
  records: 5_000,
  sourceReference: 128,
});

const boundedTextSchema = z
  .string()
  .min(1)
  .max(CLINICAL_CONTRACT_LIMITS.boundedText);
const nullableBoundedTextSchema = boundedTextSchema.nullable();
const nullableFreeTextSchema = z
  .string()
  .min(1)
  .max(CLINICAL_CONTRACT_LIMITS.freeText)
  .nullable();
const codeSchema = z.string().min(1).max(CLINICAL_CONTRACT_LIMITS.code);
const nullableCodeSchema = codeSchema.nullable();
const localDateSchema = z.string().date();
const nonNegativeFiniteNumberSchema = z.number().finite().nonnegative();

export const sourceReferenceSchema = z
  .string()
  .max(CLINICAL_CONTRACT_LIMITS.sourceReference)
  .regex(/^sr_[A-Za-z0-9_-]{16,125}$/)
  .brand<'SourceReference'>();

const diagnosisSchema = z
  .object({
    code: nullableCodeSchema,
    name: boundedTextSchema,
  })
  .strict()
  .readonly();

export const encounterRecordSchema = z
  .object({
    sourceFamily: z.literal('encounter'),
    sourceRef: sourceReferenceSchema,
    date: localDateSchema,
    facility: boundedTextSchema,
    encounterType: z.enum(['outpatient', 'emergency', 'inpatient', 'pharmacy']),
    diagnosis: diagnosisSchema,
  })
  .strict()
  .readonly();

const westernMedicationRecordObjectSchema = z
  .object({
    sourceFamily: z.literal('western-medication'),
    sourceRef: sourceReferenceSchema,
    date: localDateSchema,
    facility: boundedTextSchema,
    medicationName: boundedTextSchema,
    ingredient: nullableBoundedTextSchema,
    dosePerAdministration: z.union([
      nonNegativeFiniteNumberSchema,
      z.literal('source-stated-special'),
    ]),
    doseUnit: nullableBoundedTextSchema,
    frequency: boundedTextSchema,
    days: z.number().int().positive().max(365),
  })
  .strict();

export const westernMedicationRecordSchema =
  westernMedicationRecordObjectSchema.readonly();

const chineseMedicationRecordObjectSchema = z
  .object({
    sourceFamily: z.literal('chinese-medication'),
    sourceRef: sourceReferenceSchema,
    date: localDateSchema,
    facility: boundedTextSchema,
    medicationName: boundedTextSchema,
    ingredient: nullableBoundedTextSchema,
    dosePerAdministration: z.union([
      nonNegativeFiniteNumberSchema,
      z.literal('source-stated-special'),
    ]),
    doseUnit: nullableBoundedTextSchema,
    frequency: boundedTextSchema,
    days: z.number().int().positive().max(365),
  })
  .strict();

export const chineseMedicationRecordSchema =
  chineseMedicationRecordObjectSchema.readonly();

const presentAllergyRecordObjectSchema = z
  .object({
    sourceFamily: z.literal('allergy'),
    sourceRef: sourceReferenceSchema,
    date: localDateSchema,
    facility: boundedTextSchema,
    status: z.literal('present'),
    allergen: boundedTextSchema,
    reaction: nullableFreeTextSchema,
    severity: nullableBoundedTextSchema,
  })
  .strict();

const noKnownAllergyRecordObjectSchema = z
  .object({
    sourceFamily: z.literal('allergy'),
    sourceRef: sourceReferenceSchema,
    date: localDateSchema,
    facility: boundedTextSchema,
    status: z.literal('no-known-allergy'),
  })
  .strict();

export const allergyRecordSchema = z
  .discriminatedUnion('status', [
    presentAllergyRecordObjectSchema,
    noKnownAllergyRecordObjectSchema,
  ])
  .readonly();

export const labRecordSchema = z
  .object({
    sourceFamily: z.literal('lab'),
    sourceRef: sourceReferenceSchema,
    date: localDateSchema,
    facility: boundedTextSchema,
    itemCode: codeSchema,
    itemName: boundedTextSchema,
    sourceValue: boundedTextSchema,
    normalizedValue: z.number().finite().nullable(),
    unit: nullableBoundedTextSchema,
    sourceReferenceRange: nullableBoundedTextSchema,
    sourceAbnormalFlag: z
      .enum(['normal', 'high', 'low', 'abnormal', 'critical'])
      .nullable(),
  })
  .strict()
  .readonly();

export const imagingRecordSchema = z
  .object({
    sourceFamily: z.literal('imaging'),
    sourceRef: sourceReferenceSchema,
    date: localDateSchema,
    facility: boundedTextSchema,
    examCode: nullableCodeSchema,
    examName: boundedTextSchema,
    bodySite: nullableBoundedTextSchema,
    reportText: z
      .string()
      .min(1)
      .max(CLINICAL_CONTRACT_LIMITS.freeText)
      .nullable(),
  })
  .strict()
  .readonly();

export const procedureRecordSchema = z
  .object({
    sourceFamily: z.literal('procedure'),
    sourceRef: sourceReferenceSchema,
    date: localDateSchema,
    facility: boundedTextSchema,
    procedureCode: nullableCodeSchema,
    procedureName: boundedTextSchema,
    sourceDiagnosis: diagnosisSchema.nullable(),
  })
  .strict()
  .readonly();

export const dischargeRecordSchema = z
  .object({
    sourceFamily: z.literal('discharge'),
    sourceRef: sourceReferenceSchema,
    admissionDate: localDateSchema.nullable(),
    dischargeDate: localDateSchema,
    facility: boundedTextSchema,
    diagnosis: diagnosisSchema.nullable(),
    summaryText: z
      .string()
      .min(1)
      .max(CLINICAL_CONTRACT_LIMITS.freeText)
      .nullable(),
  })
  .strict()
  .readonly();

export const phaseOneSourceRecordSchema = z
  .union([
    encounterRecordSchema,
    westernMedicationRecordSchema,
    chineseMedicationRecordSchema,
    allergyRecordSchema,
    labRecordSchema,
    imagingRecordSchema,
    procedureRecordSchema,
    dischargeRecordSchema,
  ])
  .readonly();

const phaseOneSourceRecordsSchema = z
  .array(phaseOneSourceRecordSchema)
  .max(CLINICAL_CONTRACT_LIMITS.records)
  .readonly();

const clinicalProjectionV1ObjectSchema = z
  .object({
    contractVersion: clinicalProjectionContractVersionSchema,
    records: phaseOneSourceRecordsSchema,
    coverage: snapshotCoverageSchema,
  })
  .strict();

function addCoverageConsistencyIssues(
  projection: {
    readonly records: readonly {
      readonly sourceFamily: PhaseOneSourceFamily;
      readonly sourceRef: string;
    }[];
    readonly coverage: SnapshotCoverage;
  },
  context: z.RefinementCtx,
): void {
  const seenSourceReferences = new Set<string>();

  for (const [recordIndex, record] of projection.records.entries()) {
    if (seenSourceReferences.has(record.sourceRef)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sourceRef must be unique within the projection',
        path: ['records', recordIndex, 'sourceRef'],
      });
    }
    seenSourceReferences.add(record.sourceRef);
  }

  for (const sourceFamily of PHASE_ONE_SOURCE_FAMILIES) {
    const actualCount = projection.records.filter(
      (record) => record.sourceFamily === sourceFamily,
    ).length;
    const familyCoverage = projection.coverage[sourceFamily];

    if (familyCoverage.recordCount !== actualCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `coverage count does not match ${sourceFamily} records`,
        path: ['coverage', sourceFamily, 'recordCount'],
      });
    }
  }
}

export const clinicalProjectionV1Schema = clinicalProjectionV1ObjectSchema
  .superRefine(addCoverageConsistencyIssues)
  .readonly();

export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type EncounterRecord = z.infer<typeof encounterRecordSchema>;
export type WesternMedicationRecord = z.infer<
  typeof westernMedicationRecordSchema
>;
export type ChineseMedicationRecord = z.infer<
  typeof chineseMedicationRecordSchema
>;
export type AllergyRecord = z.infer<typeof allergyRecordSchema>;
export type LabRecord = z.infer<typeof labRecordSchema>;
export type ImagingRecord = z.infer<typeof imagingRecordSchema>;
export type ProcedureRecord = z.infer<typeof procedureRecordSchema>;
export type DischargeRecord = z.infer<typeof dischargeRecordSchema>;
export type PhaseOneSourceRecord = z.infer<typeof phaseOneSourceRecordSchema>;
export type ClinicalProjectionV1 = z.infer<typeof clinicalProjectionV1Schema>;

export { CLINICAL_PROJECTION_CONTRACT_VERSION };
