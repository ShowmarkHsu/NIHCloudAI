import { z } from 'zod';

import {
  CLINICAL_CONTRACT_LIMITS,
  type LabRecord,
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
const nullableBoundedTextSchema = boundedTextSchema.nullable();

const normalizedLabSchema = z
  .object({
    date: z.string().date(),
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
  .strict();

type NormalizedLab = z.infer<typeof normalizedLabSchema>;

function labTextFailure(
  normalized: NormalizedLab,
  knownDirectIdentifiers: unknown,
) {
  return canonicalTextFailure(
    [
      normalized.facility,
      normalized.itemCode,
      normalized.itemName,
      normalized.sourceValue,
      normalized.unit,
      normalized.sourceReferenceRange,
      normalized.sourceAbnormalFlag,
    ],
    knownDirectIdentifiers,
  );
}

/**
 * Projects source-normalized lab rows before display grouping or UI rules.
 * Source reference ranges and flags are carried verbatim from the source;
 * custom display ranges are intentionally not consulted here.
 */
export function projectLabSourceFamily(
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  const parsed = z
    .array(normalizedLabSchema)
    .max(CLINICAL_CONTRACT_LIMITS.records)
    .safeParse(normalizedRecords);
  if (!parsed.success) {
    return quarantinedSourceFamily('lab', 'SOURCE_SCHEMA_REJECTED');
  }

  const records: LabRecord[] = [];
  for (const normalized of parsed.data) {
    const textFailure = labTextFailure(normalized, knownDirectIdentifiers);
    if (textFailure !== null) {
      return quarantinedSourceFamily('lab', textFailure);
    }

    const sourceRef = issueLocalOpaqueSourceReference(issueReference);
    if (sourceRef === null) {
      return quarantinedSourceFamily('lab', 'SOURCE_SCHEMA_REJECTED');
    }

    records.push({
      sourceFamily: 'lab',
      sourceRef,
      date: normalized.date,
      facility: normalized.facility,
      itemCode: normalized.itemCode,
      itemName: normalized.itemName,
      sourceValue: normalized.sourceValue,
      normalizedValue: normalized.normalizedValue,
      unit: normalized.unit,
      sourceReferenceRange: normalized.sourceReferenceRange,
      sourceAbnormalFlag: normalized.sourceAbnormalFlag,
    });
  }

  return (
    sanitizeProjectionSourceFamily('lab', records, knownDirectIdentifiers) ??
    quarantinedSourceFamily('lab', 'SOURCE_SCHEMA_REJECTED')
  );
}
