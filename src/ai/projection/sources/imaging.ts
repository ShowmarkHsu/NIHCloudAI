import { z } from 'zod';

import {
  CLINICAL_CONTRACT_LIMITS,
  type ImagingRecord,
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
const nullableCodeSchema = z
  .string()
  .min(1)
  .max(CLINICAL_CONTRACT_LIMITS.code)
  .nullable();

const normalizedImagingSchema = z
  .object({
    date: z.string().date(),
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
  .strict();

type NormalizedImaging = z.infer<typeof normalizedImagingSchema>;

function imagingTextFailure(
  normalized: NormalizedImaging,
  knownDirectIdentifiers: unknown,
) {
  return canonicalTextFailure(
    [
      normalized.facility,
      normalized.examCode,
      normalized.examName,
      normalized.bodySite,
      normalized.reportText,
    ],
    knownDirectIdentifiers,
  );
}

/**
 * Projects only the de-identified, bounded imaging fields. URL, file and
 * internal-ID fields are deliberately not part of the normalized schema.
 */
export function projectImagingSourceFamily(
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  const parsed = z
    .array(normalizedImagingSchema)
    .max(CLINICAL_CONTRACT_LIMITS.records)
    .safeParse(normalizedRecords);
  if (!parsed.success) {
    return quarantinedSourceFamily('imaging', 'SOURCE_SCHEMA_REJECTED');
  }

  const records: ImagingRecord[] = [];
  for (const normalized of parsed.data) {
    const textFailure = imagingTextFailure(normalized, knownDirectIdentifiers);
    if (textFailure !== null) {
      return quarantinedSourceFamily('imaging', textFailure);
    }

    const sourceRef = issueLocalOpaqueSourceReference(issueReference);
    if (sourceRef === null) {
      return quarantinedSourceFamily('imaging', 'SOURCE_SCHEMA_REJECTED');
    }

    records.push({
      sourceFamily: 'imaging',
      sourceRef,
      date: normalized.date,
      facility: normalized.facility,
      examCode: normalized.examCode,
      examName: normalized.examName,
      bodySite: normalized.bodySite,
      reportText: normalized.reportText,
    });
  }

  return (
    sanitizeProjectionSourceFamily('imaging', records, knownDirectIdentifiers) ??
    quarantinedSourceFamily('imaging', 'SOURCE_SCHEMA_REJECTED')
  );
}
