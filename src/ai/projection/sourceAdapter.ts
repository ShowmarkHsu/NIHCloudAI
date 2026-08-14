import { sourceReferenceSchema, type SourceReference } from '../contracts/clinicalProjection';
import {
  sanitizeFreeText,
  type SourceFamilyQuarantineReason,
  type SourceFamilySanitizationResult,
} from '../contracts/projectionSanitizer';
import { type PhaseOneSourceFamily } from '../contracts/coverage';

export type SourceReferenceIssuer = () => unknown;

const encodedIdentityReferencePattern = /(?:patient|session|internal|(?:^|_)pt_|(?:^|_)ds_)/iu;

export function quarantinedSourceFamily(
  sourceFamily: PhaseOneSourceFamily,
  reasonCode: SourceFamilyQuarantineReason,
): SourceFamilySanitizationResult {
  return Object.freeze({
    status: 'quarantined',
    sourceFamily,
    records: Object.freeze([]) as readonly [],
    reasonCode,
  });
}

export function issueLocalOpaqueSourceReference(
  issueReference: SourceReferenceIssuer,
): SourceReference | null {
  let candidate: unknown;
  try {
    candidate = issueReference();
  } catch {
    return null;
  }

  const parsed = sourceReferenceSchema.safeParse(candidate);
  if (!parsed.success || encodedIdentityReferencePattern.test(parsed.data)) {
    return null;
  }
  return parsed.data;
}

export function canonicalTextFailure(
  values: readonly (string | null)[],
  knownDirectIdentifiers: unknown,
): SourceFamilyQuarantineReason | null {
  for (const value of values) {
    if (value === null) continue;
    const sanitized = sanitizeFreeText(value, knownDirectIdentifiers);
    if (sanitized.status === 'rejected') return sanitized.reasonCode;
    if (sanitized.text !== value) return 'SOURCE_TEXT_SANITIZATION_FAILED';
  }
  return null;
}
