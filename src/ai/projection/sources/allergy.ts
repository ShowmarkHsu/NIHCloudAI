import { z } from 'zod';

import { type AllergyRecord } from '../../contracts/clinicalProjection';
import { sanitizeProjectionSourceFamily, type SourceFamilySanitizationResult } from '../../contracts/projectionSanitizer';
import { canonicalTextFailure, issueLocalOpaqueSourceReference, quarantinedSourceFamily, type SourceReferenceIssuer } from '../sourceAdapter';

const presentAllergySchema = z.object({
  date: z.string().date(),
  facility: z.string().min(1).max(256),
  status: z.literal('present'),
  allergen: z.string().min(1).max(256),
  reaction: z.string().min(1).max(8_000).nullable(),
  severity: z.string().min(1).max(256).nullable(),
}).strict();

const noKnownAllergySchema = z.object({
  date: z.string().date(),
  facility: z.string().min(1).max(256),
  status: z.literal('no-known-allergy'),
}).strict();

const normalizedAllergySchema = z.discriminatedUnion('status', [presentAllergySchema, noKnownAllergySchema]);

export function projectAllergySourceFamily(
  normalizedRecords: unknown,
  knownDirectIdentifiers: unknown,
  issueReference: SourceReferenceIssuer,
): SourceFamilySanitizationResult {
  const parsed = z.array(normalizedAllergySchema).max(5_000).safeParse(normalizedRecords);
  if (!parsed.success) return quarantinedSourceFamily('allergy', 'SOURCE_SCHEMA_REJECTED');

  const records: AllergyRecord[] = [];
  for (const normalized of parsed.data) {
    const textValues = normalized.status === 'present'
      ? [normalized.facility, normalized.allergen, normalized.reaction, normalized.severity]
      : [normalized.facility];
    const textFailure = canonicalTextFailure(textValues, knownDirectIdentifiers);
    if (textFailure !== null) return quarantinedSourceFamily('allergy', textFailure);
    const sourceRef = issueLocalOpaqueSourceReference(issueReference);
    if (sourceRef === null) return quarantinedSourceFamily('allergy', 'SOURCE_SCHEMA_REJECTED');
    if (normalized.status === 'present') {
      records.push({
        sourceFamily: 'allergy', sourceRef, date: normalized.date, facility: normalized.facility,
        status: 'present', allergen: normalized.allergen, reaction: normalized.reaction,
        severity: normalized.severity,
      });
    } else {
      records.push({
        sourceFamily: 'allergy', sourceRef, date: normalized.date, facility: normalized.facility,
        status: 'no-known-allergy',
      });
    }
  }

  return sanitizeProjectionSourceFamily('allergy', records, knownDirectIdentifiers)
    ?? quarantinedSourceFamily('allergy', 'SOURCE_SCHEMA_REJECTED');
}
