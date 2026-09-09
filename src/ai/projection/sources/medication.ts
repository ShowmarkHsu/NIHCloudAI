import { z } from 'zod';

import { type ChineseMedicationRecord, type WesternMedicationRecord } from '../../contracts/clinicalProjection';
import { sanitizeProjectionSourceFamily, type SourceFamilySanitizationResult } from '../../contracts/projectionSanitizer';
import { canonicalTextFailure, issueLocalOpaqueSourceReference, quarantinedSourceFamily, type SourceReferenceIssuer } from '../sourceAdapter';

const normalizedMedicationSchema = z.object({
  date: z.string().date(),
  facility: z.string().min(1).max(256),
  medicationName: z.string().min(1).max(256),
  ingredient: z.string().min(1).max(256).nullable(),
  dosePerAdministration: z.union([z.number().finite().nonnegative(), z.literal('source-stated-special')]),
  doseUnit: z.string().min(1).max(256).nullable(),
  frequency: z.string().min(1).max(256),
  days: z.number().int().positive().max(365),
}).strict();

type NormalizedMedication = z.infer<typeof normalizedMedicationSchema>;

function projectMedicationFamily(
  sourceFamily: 'western-medication' | 'chinese-medication',
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  const parsed = z.array(normalizedMedicationSchema).max(5_000).safeParse(normalizedRecords);
  if (!parsed.success) return quarantinedSourceFamily(sourceFamily, 'SOURCE_SCHEMA_REJECTED');

  const records: (WesternMedicationRecord | ChineseMedicationRecord)[] = [];
  for (const normalized of parsed.data) {
    const textFailure = medicationTextFailure(normalized, knownDirectIdentifiers);
    if (textFailure !== null) return quarantinedSourceFamily(sourceFamily, textFailure);
    const sourceRef = issueLocalOpaqueSourceReference(issueReference);
    if (sourceRef === null) return quarantinedSourceFamily(sourceFamily, 'SOURCE_SCHEMA_REJECTED');
    records.push({
      sourceFamily, sourceRef, date: normalized.date, facility: normalized.facility,
      medicationName: normalized.medicationName, ingredient: normalized.ingredient,
      dosePerAdministration: normalized.dosePerAdministration, doseUnit: normalized.doseUnit,
      frequency: normalized.frequency, days: normalized.days,
    });
  }

  return sanitizeProjectionSourceFamily(sourceFamily, records, knownDirectIdentifiers)
    ?? quarantinedSourceFamily(sourceFamily, 'SOURCE_SCHEMA_REJECTED');
}

function medicationTextFailure(
  normalized: NormalizedMedication,
  knownDirectIdentifiers: unknown,
) {
  return canonicalTextFailure(
    [normalized.facility, normalized.medicationName, normalized.ingredient, normalized.doseUnit, normalized.frequency],
    knownDirectIdentifiers,
  );
}

export function projectWesternMedicationSourceFamily(
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  return projectMedicationFamily('western-medication', normalizedRecords, knownDirectIdentifiers, issueReference);
}

export function projectChineseMedicationSourceFamily(
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  return projectMedicationFamily('chinese-medication', normalizedRecords, knownDirectIdentifiers, issueReference);
}
