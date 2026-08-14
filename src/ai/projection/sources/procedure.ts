import { z } from 'zod';

import {
  CLINICAL_CONTRACT_LIMITS,
  type ProcedureRecord,
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
const codeSchema = z.string().min(1).max(CLINICAL_CONTRACT_LIMITS.code);
const nullableCodeSchema = codeSchema.nullable();
const nullableBoundedTextSchema = boundedTextSchema.nullable();

const diagnosisSchema = z
  .object({
    code: nullableCodeSchema,
    name: boundedTextSchema,
  })
  .strict();

const procedureCoreSchema = z.object({
  date: z.string().date(),
  facility: boundedTextSchema,
  procedureCode: nullableCodeSchema,
  procedureName: boundedTextSchema,
});

const normalizedProcedureFlatSchema = procedureCoreSchema
  .extend({
    sourceDiagnosisCode: nullableCodeSchema,
    sourceDiagnosisName: nullableBoundedTextSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.sourceDiagnosisCode === null) !==
      (value.sourceDiagnosisName === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source diagnosis code and name must be both present or absent',
        path: ['sourceDiagnosisName'],
      });
    }
  });

const normalizedProcedureNestedSchema = procedureCoreSchema
  .extend({
    sourceDiagnosis: diagnosisSchema.nullable(),
  })
  .strict();

const normalizedProcedureSchema = z.union([
  normalizedProcedureFlatSchema,
  normalizedProcedureNestedSchema,
]);

type NormalizedProcedure = z.infer<typeof normalizedProcedureSchema>;

function procedureDiagnosis(
  normalized: NormalizedProcedure,
): {readonly code: string | null; readonly name: string} | null {
  if ('sourceDiagnosis' in normalized) {
    return normalized.sourceDiagnosis;
  }
  if (normalized.sourceDiagnosisName === null) return null;
  return {
    code: normalized.sourceDiagnosisCode,
    name: normalized.sourceDiagnosisName,
  };
}

function procedureTextFailure(
  normalized: NormalizedProcedure,
  knownDirectIdentifiers: unknown,
) {
  const diagnosis = procedureDiagnosis(normalized);
  return canonicalTextFailure(
    [
      normalized.facility,
      normalized.procedureCode,
      normalized.procedureName,
      ...(diagnosis === null ? [] : [diagnosis.code, diagnosis.name]),
    ],
    knownDirectIdentifiers,
  );
}

/** Projects source-normalized procedures and explicit source diagnoses. */
export function projectProcedureSourceFamily(
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  const parsed = z
    .array(normalizedProcedureSchema)
    .max(CLINICAL_CONTRACT_LIMITS.records)
    .safeParse(normalizedRecords);
  if (!parsed.success) {
    return quarantinedSourceFamily('procedure', 'SOURCE_SCHEMA_REJECTED');
  }

  const records: ProcedureRecord[] = [];
  for (const normalized of parsed.data) {
    const textFailure = procedureTextFailure(
      normalized,
      knownDirectIdentifiers,
    );
    if (textFailure !== null) {
      return quarantinedSourceFamily('procedure', textFailure);
    }

    const sourceRef = issueLocalOpaqueSourceReference(issueReference);
    if (sourceRef === null) {
      return quarantinedSourceFamily('procedure', 'SOURCE_SCHEMA_REJECTED');
    }

    const diagnosis = procedureDiagnosis(normalized);
    records.push({
      sourceFamily: 'procedure',
      sourceRef,
      date: normalized.date,
      facility: normalized.facility,
      procedureCode: normalized.procedureCode,
      procedureName: normalized.procedureName,
      sourceDiagnosis: diagnosis,
    });
  }

  return (
    sanitizeProjectionSourceFamily(
      'procedure',
      records,
      knownDirectIdentifiers,
    ) ?? quarantinedSourceFamily('procedure', 'SOURCE_SCHEMA_REJECTED')
  );
}
