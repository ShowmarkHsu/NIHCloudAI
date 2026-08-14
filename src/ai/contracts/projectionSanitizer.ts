import { z } from 'zod';

import {
  phaseOneSourceFamilySchema,
  type PhaseOneSourceFamily,
} from './coverage';
import {
  CLINICAL_CONTRACT_LIMITS,
  phaseOneSourceRecordSchema,
  type PhaseOneSourceRecord,
} from './clinicalProjection';

export const SOURCE_FAMILY_QUARANTINE_REASONS = [
  'SOURCE_SCHEMA_REJECTED',
  'SOURCE_IDENTITY_TAINT',
  'SOURCE_TEXT_SANITIZATION_FAILED',
] as const;

export type SourceFamilyQuarantineReason =
  (typeof SOURCE_FAMILY_QUARANTINE_REASONS)[number];

export type SanitizedFreeText =
  | { readonly status: 'accepted'; readonly text: string }
  | {
      readonly status: 'rejected';
      readonly reasonCode:
        | 'SOURCE_IDENTITY_TAINT'
        | 'SOURCE_TEXT_SANITIZATION_FAILED';
    };

export type SourceFamilySanitizationResult =
  | {
      readonly status: 'accepted';
      readonly sourceFamily: PhaseOneSourceFamily;
      readonly records: readonly PhaseOneSourceRecord[];
    }
  | {
      readonly status: 'quarantined';
      readonly sourceFamily: PhaseOneSourceFamily;
      readonly records: readonly [];
      readonly reasonCode: SourceFamilyQuarantineReason;
    };

const identityFieldNamePattern =
  /(?:patient(?:[ _-]*(?:name|id))?|display[ _-]*name|national[ _-]*id|medical[ _-]*record(?:[ _-]*number)?|card[ _-]*number|session[ _-]*id|姓名|身分證|身份證|病歷號|病历号|卡號|卡号)/iu;
const taiwanNationalIdPattern = /\b[A-Z][12]\d{8}\b/u;
const markupPattern = /<[^>]*>/gu;
const whitespacePattern = /\s+/gu;

function isPlainJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) return value.every(isPlainJsonValue);
  if (typeof value !== 'object') return false;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;

  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor') return false;
    if (!isPlainJsonValue(Reflect.get(value, key))) return false;
  }

  return true;
}

function normalizeKnownDirectIdentifiers(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;

  const identifiers: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') return null;
    const normalized = candidate.normalize('NFKC').trim();
    if (normalized.length === 0 || normalized.length > 256) return null;
    identifiers.push(normalized);
  }
  return Object.freeze(identifiers);
}

function containsIdentityTaint(
  value: string,
  knownDirectIdentifiers: readonly string[],
): boolean {
  const normalized = value.normalize('NFKC');
  if (
    identityFieldNamePattern.test(normalized) ||
    taiwanNationalIdPattern.test(normalized)
  ) {
    return true;
  }

  const folded = normalized.toLocaleLowerCase('en-US');
  return knownDirectIdentifiers.some(
    (identifier) =>
      folded.includes(identifier.normalize('NFKC').toLocaleLowerCase('en-US')),
  );
}

export function sanitizeFreeText(
  value: unknown,
  knownDirectIdentifiers: unknown,
): SanitizedFreeText {
  const identifiers = normalizeKnownDirectIdentifiers(knownDirectIdentifiers);
  if (identifiers === null || typeof value !== 'string') {
    return {status: 'rejected', reasonCode: 'SOURCE_TEXT_SANITIZATION_FAILED'};
  }
  if (value.length > CLINICAL_CONTRACT_LIMITS.freeText) {
    return {status: 'rejected', reasonCode: 'SOURCE_TEXT_SANITIZATION_FAILED'};
  }
  if (containsIdentityTaint(value, identifiers)) {
    return {status: 'rejected', reasonCode: 'SOURCE_IDENTITY_TAINT'};
  }

  const text = value
    .normalize('NFKC')
    .replace(markupPattern, ' ')
    .replace(whitespacePattern, ' ')
    .trim();
  if (text.length === 0 || text.length > CLINICAL_CONTRACT_LIMITS.freeText) {
    return {status: 'rejected', reasonCode: 'SOURCE_TEXT_SANITIZATION_FAILED'};
  }
  if (containsIdentityTaint(text, identifiers)) {
    return {status: 'rejected', reasonCode: 'SOURCE_IDENTITY_TAINT'};
  }

  return Object.freeze({status: 'accepted', text});
}

function collectClinicalText(record: PhaseOneSourceRecord): readonly string[] {
  switch (record.sourceFamily) {
    case 'encounter':
      return Object.freeze([
        record.date,
        record.facility,
        record.encounterType,
        record.diagnosis.name,
        ...(record.diagnosis.code === null ? [] : [record.diagnosis.code]),
      ]);
    case 'western-medication':
    case 'chinese-medication':
      return Object.freeze([
        record.date,
        record.facility,
        record.medicationName,
        record.doseUnit,
        record.frequency,
        ...(record.ingredient === null ? [] : [record.ingredient]),
      ]);
    case 'allergy':
      return Object.freeze([
        record.date,
        record.facility,
        record.status,
        ...(record.status === 'present'
          ? [
              record.allergen,
              ...(record.reaction === null ? [] : [record.reaction]),
              ...(record.severity === null ? [] : [record.severity]),
            ]
          : []),
      ]);
    case 'lab':
      return Object.freeze([
        record.date,
        record.facility,
        record.itemCode,
        record.itemName,
        record.sourceValue,
        ...(record.unit === null ? [] : [record.unit]),
        ...(record.sourceReferenceRange === null
          ? []
          : [record.sourceReferenceRange]),
        ...(record.sourceAbnormalFlag === null ? [] : [record.sourceAbnormalFlag]),
      ]);
    case 'imaging':
      return Object.freeze([
        record.date,
        record.facility,
        record.examName,
        ...(record.examCode === null ? [] : [record.examCode]),
        ...(record.bodySite === null ? [] : [record.bodySite]),
        ...(record.reportText === null ? [] : [record.reportText]),
      ]);
    case 'procedure':
      return Object.freeze([
        record.date,
        record.facility,
        record.procedureName,
        ...(record.procedureCode === null ? [] : [record.procedureCode]),
        ...(record.sourceDiagnosis === null
          ? []
          : [
              record.sourceDiagnosis.name,
              ...(record.sourceDiagnosis.code === null
                ? []
                : [record.sourceDiagnosis.code]),
            ]),
      ]);
    case 'discharge':
      return Object.freeze([
        record.admissionDate,
        record.dischargeDate,
        record.facility,
        record.diagnosis.name,
        ...(record.diagnosis.code === null ? [] : [record.diagnosis.code]),
        ...(record.summaryText === null ? [] : [record.summaryText]),
      ]);
  }
}

function freeTextIsCanonical(
  record: PhaseOneSourceRecord,
  knownDirectIdentifiers: readonly string[],
): SourceFamilyQuarantineReason | null {
  const freeText =
    record.sourceFamily === 'imaging'
      ? record.reportText
      : record.sourceFamily === 'discharge'
        ? record.summaryText
        : null;

  if (freeText === null) return null;
  const result = sanitizeFreeText(freeText, knownDirectIdentifiers);
  if (result.status === 'rejected') return result.reasonCode;
  return result.text === freeText ? null : 'SOURCE_TEXT_SANITIZATION_FAILED';
}

function quarantined(
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

export function sanitizeProjectionSourceFamily(
  sourceFamily: unknown,
  candidateRecords: unknown,
  knownDirectIdentifiers: unknown,
): SourceFamilySanitizationResult | null {
  const parsedSourceFamily = phaseOneSourceFamilySchema.safeParse(sourceFamily);
  if (!parsedSourceFamily.success) return null;
  const identifiers = normalizeKnownDirectIdentifiers(knownDirectIdentifiers);
  if (identifiers === null || !Array.isArray(candidateRecords)) {
    return quarantined(parsedSourceFamily.data, 'SOURCE_SCHEMA_REJECTED');
  }

  const records: PhaseOneSourceRecord[] = [];
  const sourceRefs = new Set<string>();
  for (const candidate of candidateRecords) {
    if (!isPlainJsonValue(candidate)) {
      return quarantined(parsedSourceFamily.data, 'SOURCE_SCHEMA_REJECTED');
    }

    const parsedRecord = phaseOneSourceRecordSchema.safeParse(candidate);
    if (
      !parsedRecord.success ||
      parsedRecord.data.sourceFamily !== parsedSourceFamily.data ||
      sourceRefs.has(parsedRecord.data.sourceRef)
    ) {
      return quarantined(parsedSourceFamily.data, 'SOURCE_SCHEMA_REJECTED');
    }

    if (
      collectClinicalText(parsedRecord.data).some((text) =>
        containsIdentityTaint(text, identifiers),
      )
    ) {
      return quarantined(parsedSourceFamily.data, 'SOURCE_IDENTITY_TAINT');
    }

    const freeTextFailure = freeTextIsCanonical(parsedRecord.data, identifiers);
    if (freeTextFailure !== null) {
      return quarantined(parsedSourceFamily.data, freeTextFailure);
    }

    sourceRefs.add(parsedRecord.data.sourceRef);
    records.push(parsedRecord.data);
  }

  return Object.freeze({
    status: 'accepted',
    sourceFamily: parsedSourceFamily.data,
    records: Object.freeze(records),
  });
}
