import { z } from 'zod';

import { type EncounterRecord } from '../../contracts/clinicalProjection';
import { sanitizeProjectionSourceFamily, type SourceFamilySanitizationResult } from '../../contracts/projectionSanitizer';
import { canonicalTextFailure, issueLocalOpaqueSourceReference, quarantinedSourceFamily, type SourceReferenceIssuer } from '../sourceAdapter';

const normalizedEncounterSchema = z.object({
  date: z.string().date(),
  facility: z.string().min(1).max(256),
  encounterType: z.enum(['outpatient', 'emergency', 'inpatient', 'pharmacy']),
  diagnosisCode: z.string().min(1).max(64).nullable(),
  diagnosisName: z.string().min(1).max(256),
}).strict();

export function projectEncounterSourceFamily(
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  const parsed = z.array(normalizedEncounterSchema).max(5_000).safeParse(normalizedRecords);
  if (!parsed.success) return quarantinedSourceFamily('encounter', 'SOURCE_SCHEMA_REJECTED');

  const records: EncounterRecord[] = [];
  for (const normalized of parsed.data) {
    const textFailure = canonicalTextFailure(
      [normalized.facility, normalized.diagnosisCode, normalized.diagnosisName],
      knownDirectIdentifiers,
    );
    if (textFailure !== null) return quarantinedSourceFamily('encounter', textFailure);
    const sourceRef = issueLocalOpaqueSourceReference(issueReference);
    if (sourceRef === null) return quarantinedSourceFamily('encounter', 'SOURCE_SCHEMA_REJECTED');
    records.push({
      sourceFamily: 'encounter', sourceRef, date: normalized.date, facility: normalized.facility,
      encounterType: normalized.encounterType,
      diagnosis: {code: normalized.diagnosisCode, name: normalized.diagnosisName},
    });
  }

  return sanitizeProjectionSourceFamily('encounter', records, knownDirectIdentifiers)
    ?? quarantinedSourceFamily('encounter', 'SOURCE_SCHEMA_REJECTED');
}
