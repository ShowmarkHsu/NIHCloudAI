import { z } from 'zod';

import {
  CLINICAL_CONTRACT_LIMITS,
  type DischargeRecord,
} from '../../contracts/clinicalProjection';
import {
  sanitizeProjectionSourceFamily,
  type SourceFamilySanitizationResult,
} from '../../contracts/projectionSanitizer';
import {
  canonicalTextFailure,
  issueLocalOpaqueSourceReference,
  quarantinedSourceFamily,
  type SourceReferenceIssuer,
} from '../sourceAdapter';

const boundedTextSchema = z
  .string()
  .min(1)
  .max(CLINICAL_CONTRACT_LIMITS.boundedText);
const nullableBoundedTextSchema = boundedTextSchema.nullable();
const codeSchema = z.string().min(1).max(CLINICAL_CONTRACT_LIMITS.code);
const nullableCodeSchema = codeSchema.nullable();

const diagnosisSchema = z
  .object({
    code: nullableCodeSchema,
    name: boundedTextSchema,
  })
  .strict();

const dischargeCoreSchema = z.object({
  admissionDate: z.string().date().nullable(),
  dischargeDate: z.string().date(),
  facility: boundedTextSchema,
  summaryText: z
    .string()
    .min(1)
    .max(CLINICAL_CONTRACT_LIMITS.freeText)
    .nullable(),
});

const normalizedDischargeFlatSchema = dischargeCoreSchema
  .extend({
    diagnosisCode: nullableCodeSchema,
    diagnosisName: nullableBoundedTextSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.diagnosisName === null && value.diagnosisCode !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'diagnosis code cannot be present without a diagnosis name',
        path: ['diagnosisCode'],
      });
    }
  });

const normalizedDischargeNestedSchema = dischargeCoreSchema
  .extend({
    diagnosis: diagnosisSchema.nullable(),
  })
  .strict();

const normalizedDischargeSchema = z.union([
  normalizedDischargeFlatSchema,
  normalizedDischargeNestedSchema,
]);

type NormalizedDischarge = z.infer<typeof normalizedDischargeSchema>;

function dischargeDiagnosis(
  normalized: NormalizedDischarge,
): {readonly code: string | null; readonly name: string} | null {
  if ('diagnosis' in normalized) return normalized.diagnosis;
  if (normalized.diagnosisName === null) return null;
  return {
    code: normalized.diagnosisCode,
    name: normalized.diagnosisName,
  };
}

function dischargeTextFailure(
  normalized: NormalizedDischarge,
  knownDirectIdentifiers: unknown,
) {
  const diagnosis = dischargeDiagnosis(normalized);
  return canonicalTextFailure(
    [
      normalized.facility,
      ...(diagnosis === null ? [] : [diagnosis.code, diagnosis.name]),
      normalized.summaryText,
    ],
    knownDirectIdentifiers,
  );
}

/**
 * Projects bounded, de-identified discharge data. URL, file and internal-ID
 * fields are intentionally absent from both accepted input variants/output.
 */
export function projectDischargeSourceFamily(
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  const parsed = z
    .array(normalizedDischargeSchema)
    .max(CLINICAL_CONTRACT_LIMITS.records)
    .safeParse(normalizedRecords);
  if (!parsed.success) {
    return quarantinedSourceFamily('discharge', 'SOURCE_SCHEMA_REJECTED');
  }

  const records: DischargeRecord[] = [];
  for (const normalized of parsed.data) {
    const textFailure = dischargeTextFailure(
      normalized,
      knownDirectIdentifiers,
    );
    if (textFailure !== null) {
      return quarantinedSourceFamily('discharge', textFailure);
    }

    const sourceRef = issueLocalOpaqueSourceReference(issueReference);
    if (sourceRef === null) {
      return quarantinedSourceFamily('discharge', 'SOURCE_SCHEMA_REJECTED');
    }

    const diagnosis = dischargeDiagnosis(normalized);
    records.push({
      sourceFamily: 'discharge',
      sourceRef,
      admissionDate: normalized.admissionDate,
      dischargeDate: normalized.dischargeDate,
      facility: normalized.facility,
      diagnosis,
      summaryText: normalized.summaryText,
    });
  }

  return (
    sanitizeProjectionSourceFamily(
      'discharge',
      records,
      knownDirectIdentifiers,
    ) ?? quarantinedSourceFamily('discharge', 'SOURCE_SCHEMA_REJECTED')
  );
}
