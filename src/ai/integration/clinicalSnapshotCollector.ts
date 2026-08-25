import {z} from 'zod';

import {
  CLINICAL_PROJECTION_CONTRACT_VERSION,
  type PhaseOneSourceRecord,
} from '../contracts/clinicalProjection';
import {
  type PhaseOneCoverage,
  type PhaseOneSourceFamily,
  type SnapshotCoverage,
} from '../contracts/coverage';
import {
  dataSessionIdSchema,
  opaquePatientIdSchema,
  snapshotRevisionSchema,
} from '../contracts/patientSnapshot';
import {type SourceFamilySanitizationResult} from '../contracts/projectionSanitizer';
import {type SealedPatientSnapshot, sealVersionedPatientSnapshot} from '../projection/builder';
import {projectAllergySourceFamily} from '../projection/sources/allergy';
import {projectDischargeSourceFamily} from '../projection/sources/discharge';
import {projectEncounterSourceFamily} from '../projection/sources/encounter';
import {projectImagingSourceFamily} from '../projection/sources/imaging';
import {projectLabSourceFamily} from '../projection/sources/lab';
import {
  projectChineseMedicationSourceFamily,
  projectWesternMedicationSourceFamily,
} from '../projection/sources/medication';
import {projectProcedureSourceFamily} from '../projection/sources/procedure';

export type ClinicalSnapshotScope = Readonly<{
  patientId: string;
  sessionId: string;
  revision: number;
}>;

export type ClinicalSnapshotCollectorResult = Readonly<{
  sealed: SealedPatientSnapshot;
  sourceAliases: readonly Readonly<{sourceRef: string; label: string}>[];
}>;

export type ClinicalSnapshotCollectorConfiguration = Readonly<{
  now: () => string;
  issueSourceReference: () => unknown;
  knownDirectIdentifiers?: () => unknown;
}>;

const dataTypeSchema = z.enum([
  'encounter', 'medication', 'chinesemed', 'allergy', 'lab', 'labdata',
  'imaging', 'surgery', 'discharge',
]);
const sourceEnvelopeSchema = z.object({rObject: z.array(z.unknown()).max(5_000)}).strict();
const terminalSourceResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'), dataType: dataTypeSchema, data: sourceEnvelopeSchema,
    recordCount: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    status: z.literal('nodata'), dataType: dataTypeSchema, recordCount: z.literal(0),
    data: sourceEnvelopeSchema.optional(),
  }).strict(),
  z.object({
    status: z.literal('unauthorized'), dataType: dataTypeSchema, recordCount: z.literal(0),
    reasonCode: z.literal('SOURCE_UNAUTHORIZED'),
  }).strict(),
  z.object({
    status: z.literal('failure'), dataType: dataTypeSchema, recordCount: z.literal(0).optional(),
    reasonCode: z.enum(['SOURCE_REQUEST_FAILED', 'SOURCE_TIMEOUT']),
  }).strict(),
]);

type TerminalSourceResult = z.infer<typeof terminalSourceResultSchema>;
type MutableCoverage = {-readonly [Key in keyof SnapshotCoverage]: SnapshotCoverage[Key]};

const DATA_TYPE_TO_FAMILY = Object.freeze({
  encounter: 'encounter', medication: 'western-medication', chinesemed: 'chinese-medication',
  allergy: 'allergy', lab: 'lab', labdata: 'lab', imaging: 'imaging', surgery: 'procedure',
  discharge: 'discharge',
} satisfies Readonly<Record<TerminalSourceResult['dataType'], PhaseOneSourceFamily>>);

const SOURCE_LABELS = Object.freeze({
  encounter: '就醫來源', 'western-medication': '西藥來源', 'chinese-medication': '中藥來源',
  allergy: '過敏來源', lab: '檢驗來源', imaging: '影像來源', procedure: '處置來源',
  discharge: '出院來源',
} satisfies Readonly<Record<PhaseOneSourceFamily, string>>);

function baselineCoverage(): MutableCoverage {
  const notCollected = {
    status: 'not-collected' as const, recordCount: 0 as const,
    reasonCode: 'SOURCE_NOT_COLLECTED' as const,
  };
  const outOfScope = {
    status: 'out-of-scope' as const, recordCount: 0 as const,
    reasonCode: 'SOURCE_NOT_IN_CONTRACT' as const,
  };
  return {
    encounter: {...notCollected}, 'western-medication': {...notCollected},
    'chinese-medication': {...notCollected}, allergy: {...notCollected}, lab: {...notCollected},
    imaging: {...notCollected}, procedure: {...notCollected}, discharge: {...notCollected},
    'adult-health-check': {...outOfScope}, 'cancer-screening': {...outOfScope},
    'hepatitis-bc': {...outOfScope}, 'ckm-derived': {...outOfScope},
  };
}

function assertScope(scope: ClinicalSnapshotScope): void {
  if (
    !opaquePatientIdSchema.safeParse(scope.patientId).success
    || !dataSessionIdSchema.safeParse(scope.sessionId).success
    || !snapshotRevisionSchema.safeParse(scope.revision).success
  ) throw new RangeError('clinical collector requires a closed patient/session/revision scope');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownString(record: Record<string, unknown>, key: string): string | null {
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  if (typeof value !== 'string') return null;
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim() || null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = ownString(record, key);
    if (value !== null) return value;
  }
  return null;
}

function finiteNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) continue;
    const value = record[key];
    const parsed = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value.trim())
        ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function positiveInteger(record: Record<string, unknown>, keys: readonly string[]): number | null {
  const value = finiteNumber(record, keys);
  return value !== null && Number.isInteger(value) && value > 0 && value <= 365 ? value : null;
}

function localDate(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.split('T', 1)[0]?.trim() ?? '';
  const delimited = /^(\d{3,4})[/-](\d{1,2})[/-](\d{1,2})$/u.exec(normalized);
  const compact = /^(\d{4})(\d{2})(\d{2})$/u.exec(normalized);
  if (delimited === null && compact === null) return null;
  const sourceYear = Number(delimited?.[1] ?? compact?.[1]);
  const year = String(sourceYear < 1911 ? sourceYear + 1911 : sourceYear).padStart(4, '0');
  const month = String(delimited?.[2] ?? compact?.[2]).padStart(2, '0');
  const day = String(delimited?.[3] ?? compact?.[3]).padStart(2, '0');
  const result = `${year}-${month}-${day}`;
  return z.string().date().safeParse(result).success ? result : null;
}

function rowDate(record: Record<string, unknown>, keys: readonly string[]): string | null {
  return localDate(firstString(record, keys));
}

function facility(record: Record<string, unknown>): string | null {
  return firstString(record, ['facility', 'hospital', 'hosp'])?.split(';', 1)[0]?.trim() || null;
}

function encounterType(record: Record<string, unknown>): 'outpatient' | 'emergency' | 'inpatient' | 'pharmacy' | null {
  const explicit = firstString(record, ['encounter_type', 'encounterType', 'visit_type', 'func_type_name']);
  const source = explicit ?? ownString(record, 'hosp')?.split(';')[1]?.trim() ?? null;
  if (source === null) return null;
  const folded = source.toLocaleLowerCase('en-US');
  if (folded.includes('pharmacy') || source.includes('藥局')) return 'pharmacy';
  if (folded.includes('emergency') || source.includes('急診')) return 'emergency';
  if (folded.includes('inpatient') || source.includes('住院')) return 'inpatient';
  if (folded.includes('outpatient') || source.includes('門診')) return 'outpatient';
  return null;
}

function normalizeEncounterRowForDateKeys(value: unknown, dateKeys: readonly string[]): unknown | null {
  if (!isPlainRecord(value)) return null;
  const date = rowDate(value, dateKeys);
  const sourceFacility = facility(value);
  const sourceEncounterType = encounterType(value);
  const diagnosisName = firstString(value, ['diagnosis_name', 'icd_cname']);
  if (date === null || sourceFacility === null || sourceEncounterType === null) return null;
  return Object.freeze({
    date, facility: sourceFacility, encounterType: sourceEncounterType,
    diagnosisCode: diagnosisName === null ? null : firstString(value, ['diagnosis_code', 'icd_code']),
    diagnosisName,
  });
}

function normalizeEncounterRow(value: unknown): unknown | null {
  return normalizeEncounterRowForDateKeys(value, ['date', 'func_date', 'visit_date']);
}

const DAILY_FREQUENCIES = Object.freeze(new Map<string, number>([
  ['QD', 1], ['QDP', 1], ['QAM', 1], ['QPM', 1], ['QN', 1], ['HS', 1], ['HSP', 1],
  ['DAILY', 1], ['BID', 2], ['BIDP', 2], ['TID', 3], ['TIDP', 3], ['QID', 4], ['QIDP', 4],
  ['Q2H', 12], ['Q4H', 6], ['Q6H', 4], ['Q8H', 3], ['Q12H', 2],
]));

function dosePerAdministration(total: number, frequency: string, days: number): number | 'source-stated-special' {
  const token = frequency.toUpperCase().match(/[A-Z0-9]+/u)?.[0] ?? '';
  const timesPerDay = DAILY_FREQUENCIES.get(token);
  if (timesPerDay === undefined) return 'source-stated-special';
  const result = total / (timesPerDay * days);
  return Number.isFinite(result) && result >= 0 ? Math.round(result * 100) / 100 : 'source-stated-special';
}

function normalizeMedicationRow(value: unknown, chinese: boolean): unknown | null {
  if (!isPlainRecord(value)) return null;
  const date = rowDate(value, chinese ? ['func_date', 'date'] : ['drug_date', 'PER_DATE', 'date']);
  const sourceFacility = facility(value);
  const medicationName = chinese
    ? firstString(value, ['drug_perscrn_name', 'cdrug_name', 'medication_name'])
    : firstString(value, ['drug_ename', 'MED_DESC', 'MED_ITEM', 'drug_ing_name', 'medication_name']);
  const total = finiteNumber(value, chinese ? ['order_qty', 'qty'] : ['qty', 'DOSAGE']);
  const frequency = firstString(value, ['drug_fre', 'FREQ_DESC', 'frequency']);
  const days = positiveInteger(value, ['day', 'MED_DAYS', 'days']);
  if (
    date === null || sourceFacility === null || medicationName === null
    || total === null || total < 0 || frequency === null || days === null
  ) return null;
  return Object.freeze({
    date, facility: sourceFacility, medicationName,
    ingredient: chinese ? null : firstString(value, ['drug_ing_name', 'GENERIC_NAME', 'ingredient']),
    dosePerAdministration: dosePerAdministration(total, frequency, days),
    doseUnit: chinese
      ? firstString(value, ['dose_unit'])
      : firstString(value, ['dose_unit', 'unit']),
    frequency, days,
  });
}

function normalizeAllergyRow(value: unknown): unknown | null {
  if (!isPlainRecord(value)) return null;
  const date = rowDate(value, ['upload_d', 'occur_date', 'date']);
  const sourceFacility = facility(value);
  const allergen = firstString(value, ['drug_name', 'allergen'])?.replace(/;;$/u, '').trim() || null;
  if (date === null || sourceFacility === null || allergen === null) return null;
  if (allergen.includes('未過敏')) return Object.freeze({date, facility: sourceFacility, status: 'no-known-allergy'});
  return Object.freeze({
    date, facility: sourceFacility, status: 'present', allergen,
    reaction: firstString(value, ['sympton_name', 'reaction'])?.split(';').filter(Boolean).join('、') || null,
    severity: firstString(value, ['allerg_severity_level', 'severity']),
  });
}

function sourceAbnormalFlag(value: string | null): 'normal' | 'high' | 'low' | 'abnormal' | 'critical' | null {
  switch (value?.toUpperCase()) {
    case '0': case 'N': case 'NORMAL': return 'normal';
    case 'H': case 'HIGH': return 'high';
    case 'L': case 'LOW': return 'low';
    case 'A': case 'ABNORMAL': return 'abnormal';
    case 'C': case 'CRITICAL': return 'critical';
    default: return null;
  }
}

function normalizeLabRow(value: unknown): unknown | null {
  if (!isPlainRecord(value)) return null;
  const date = rowDate(value, ['real_inspect_date', 'recipe_date']);
  const sourceFacility = facility(value);
  const itemCode = firstString(value, ['order_code']);
  const itemName = firstString(value, ['assay_item_name', 'order_name']);
  const sourceValue = firstString(value, ['assay_value']);
  if (date === null || sourceFacility === null || itemCode === null || itemName === null || sourceValue === null) return null;
  const numeric = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(sourceValue) ? Number(sourceValue) : null;
  return Object.freeze({
    date, facility: sourceFacility, itemCode, itemName, sourceValue,
    normalizedValue: numeric !== null && Number.isFinite(numeric) ? numeric : null,
    unit: firstString(value, ['unit_data']),
    sourceReferenceRange: firstString(value, ['consult_value']),
    sourceAbnormalFlag: sourceAbnormalFlag(firstString(value, ['assay_mark'])),
  });
}

function canonicalJoinedText(values: readonly (string | null)[]): string | null {
  const text = values.filter((value): value is string => value !== null).join(' ').replace(/\s+/gu, ' ').trim();
  return text || null;
}

function normalizeImagingRow(value: unknown): unknown | null {
  if (!isPlainRecord(value)) return null;
  const date = rowDate(value, ['real_inspect_date', 'case_time', 'recipe_date', 'date']);
  const sourceFacility = facility(value);
  const examName = firstString(value, ['order_name', 'assay_item_name', 'exam_name']);
  if (date === null || sourceFacility === null || examName === null) return null;
  return Object.freeze({
    date, facility: sourceFacility,
    examCode: firstString(value, ['order_code', 'exam_code']), examName,
    bodySite: firstString(value, ['cure_path_name', 'body_site']),
    reportText: canonicalJoinedText([
      firstString(value, ['inspect_result']), firstString(value, ['path_diag_1']),
      firstString(value, ['path_diag_2']), firstString(value, ['path_diag_3']),
    ]),
  });
}

function normalizeProcedureRow(value: unknown): unknown | null {
  if (!isPlainRecord(value)) return null;
  const date = rowDate(value, ['exe_s_date', 'func_date', 'date']);
  const sourceFacility = facility(value);
  const procedureCode = firstString(value, ['order_code', 'procedure_code']);
  const procedureName = firstString(value, ['order_ename', 'order_name', 'cure_path_name', 'procedure_name']) ?? procedureCode;
  if (date === null || sourceFacility === null || procedureName === null) return null;
  const diagnosisName = firstString(value, ['icd_cname', 'diagnosis_name']);
  return Object.freeze({
    date, facility: sourceFacility, procedureCode, procedureName,
    sourceDiagnosisCode: diagnosisName === null ? null : firstString(value, ['icd_code', 'diagnosis_code']),
    sourceDiagnosisName: diagnosisName,
  });
}

function normalizeDischargeRow(value: unknown): unknown | null {
  if (!isPlainRecord(value)) return null;
  const admissionDate = rowDate(value, ['in_date', 'admission_date']);
  const dischargeDate = rowDate(value, ['out_date', 'discharge_date']);
  const sourceFacility = facility(value);
  const diagnosisName = firstString(value, ['icd_cname', 'diagnosis_name']);
  if (dischargeDate === null || sourceFacility === null) return null;
  return Object.freeze({
    admissionDate, dischargeDate, facility: sourceFacility,
    diagnosisCode: diagnosisName === null ? null : firstString(value, ['icd_code', 'diagnosis_code']),
    diagnosisName,
    summaryText: canonicalJoinedText([
      firstString(value, ['summary_text']), firstString(value, ['discharge_summary']),
    ]),
  });
}

type SourceProjector = (
  normalizedRecords: unknown, knownDirectIdentifiers: unknown, issueReference: () => unknown,
) => SourceFamilySanitizationResult;
type SourceDefinition = Readonly<{
  normalize: (value: unknown) => unknown | null;
  project: SourceProjector;
}>;

const SOURCE_DEFINITIONS = Object.freeze({
  encounter: {normalize: normalizeEncounterRow, project: projectEncounterSourceFamily},
  'western-medication': {
    normalize: (value: unknown) => normalizeMedicationRow(value, false),
    project: projectWesternMedicationSourceFamily,
  },
  'chinese-medication': {
    normalize: (value: unknown) => normalizeMedicationRow(value, true),
    project: projectChineseMedicationSourceFamily,
  },
  allergy: {normalize: normalizeAllergyRow, project: projectAllergySourceFamily},
  lab: {normalize: normalizeLabRow, project: projectLabSourceFamily},
  imaging: {normalize: normalizeImagingRow, project: projectImagingSourceFamily},
  procedure: {normalize: normalizeProcedureRow, project: projectProcedureSourceFamily},
  discharge: {normalize: normalizeDischargeRow, project: projectDischargeSourceFamily},
} satisfies Readonly<Record<PhaseOneSourceFamily, SourceDefinition>>);

function terminalResults(value: unknown): readonly TerminalSourceResult[] | null {
  const candidates = Array.isArray(value) ? value : [value];
  const results: TerminalSourceResult[] = [];
  const seenFamilies = new Set<PhaseOneSourceFamily>();
  for (const candidate of candidates) {
    const parsed = terminalSourceResultSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const family = DATA_TYPE_TO_FAMILY[parsed.data.dataType];
    if (seenFamilies.has(family)) return null;
    seenFamilies.add(family);
    results.push(parsed.data);
  }
  return results.length === 0 ? null : Object.freeze(results);
}

function quarantinedFamily(sourceFamily: PhaseOneSourceFamily): SourceFamilySanitizationResult {
  return Object.freeze({
    status: 'quarantined', sourceFamily, records: Object.freeze([]) as readonly [],
    reasonCode: 'SOURCE_SCHEMA_REJECTED',
  });
}

function projectSuccess(
  terminal: Extract<TerminalSourceResult, {status: 'success'}>,
  knownDirectIdentifiers: unknown,
  issueSourceReference: () => unknown,
): SourceFamilySanitizationResult {
  const family = DATA_TYPE_TO_FAMILY[terminal.dataType];
  const definition = SOURCE_DEFINITIONS[family];
  if (terminal.recordCount !== undefined && terminal.recordCount !== terminal.data.rObject.length) {
    return quarantinedFamily(family);
  }
  const normalized = terminal.data.rObject.map(definition.normalize);
  if (normalized.some((row) => row === null)) return quarantinedFamily(family);
  return definition.project(normalized, knownDirectIdentifiers, issueSourceReference);
}

type ClaimsEncounterOutcome = Readonly<{
  coverage: PhaseOneCoverage;
  records: readonly PhaseOneSourceRecord[];
}>;

/**
 * Projects only explicit visit-header fields already present on both claim
 * sources. Both western and Chinese claim terminals must be available so the
 * encounter family is never presented as complete from a partial source set.
 */
function claimsEncounterOutcome(
  terminals: readonly TerminalSourceResult[],
  knownDirectIdentifiers: unknown,
  issueSourceReference: () => unknown,
): ClaimsEncounterOutcome | null {
  if (terminals.some((terminal) => terminal.dataType === 'encounter')) return null;
  const claimTerminals = terminals.filter((terminal) =>
    terminal.dataType === 'medication' || terminal.dataType === 'chinesemed',
  );
  if (claimTerminals.length !== 2) return null;

  const failed = claimTerminals.find((terminal) => terminal.status === 'failure');
  if (failed?.status === 'failure') {
    return Object.freeze({
      coverage: {
        status: 'fetch-failure', recordCount: 0, reasonCode: failed.reasonCode,
      },
      records: Object.freeze([]),
    });
  }
  if (claimTerminals.some((terminal) => terminal.status === 'unauthorized')) {
    return Object.freeze({
      coverage: {
        status: 'unauthorized', recordCount: 0, reasonCode: 'SOURCE_UNAUTHORIZED',
      },
      records: Object.freeze([]),
    });
  }

  const normalized: unknown[] = [];
  for (const terminal of claimTerminals) {
    if (terminal.status !== 'success') continue;
    if (terminal.recordCount !== undefined && terminal.recordCount !== terminal.data.rObject.length) {
      return Object.freeze({
        coverage: {
          status: 'normalization-failure', recordCount: 0, reasonCode: 'SOURCE_SCHEMA_REJECTED',
        },
        records: Object.freeze([]),
      });
    }
    const dateKeys = terminal.dataType === 'medication'
      ? ['drug_date', 'PER_DATE', 'date']
      : ['func_date', 'date'];
    const familyRows = terminal.data.rObject.map((row) =>
      normalizeEncounterRowForDateKeys(row, dateKeys),
    );
    if (familyRows.some((row) => row === null)) {
      return Object.freeze({
        coverage: {
          status: 'normalization-failure', recordCount: 0, reasonCode: 'SOURCE_SCHEMA_REJECTED',
        },
        records: Object.freeze([]),
      });
    }
    normalized.push(...familyRows);
  }

  const deduplicated = [...new Map(normalized.map((row) => [JSON.stringify(row), row])).values()];
  const projected = projectEncounterSourceFamily(
    deduplicated,
    knownDirectIdentifiers,
    issueSourceReference,
  );
  if (projected.status === 'quarantined') {
    return Object.freeze({
      coverage: {
        status: 'normalization-failure', recordCount: 0, reasonCode: projected.reasonCode,
      },
      records: Object.freeze([]),
    });
  }
  return Object.freeze({
    coverage: projected.records.length === 0
      ? {status: 'confirmed-empty', recordCount: 0}
      : {status: 'has-data', recordCount: projected.records.length},
    records: projected.records,
  });
}

/**
 * The revision-wide deep module. Its caller supplies one terminal source batch
 * and a closed scope; source allowlists, normalization, family quarantine,
 * coverage, aliases, revision continuity, vault construction, and sealing stay
 * behind this interface.
 */
export function createClinicalSnapshotCollector(configuration: ClinicalSnapshotCollectorConfiguration) {
  const sealedBySession = new Map<string, SealedPatientSnapshot>();

  return Object.freeze({
    ingest(scope: ClinicalSnapshotScope, value: unknown): ClinicalSnapshotCollectorResult | null {
      assertScope(scope);
      const terminals = terminalResults(value);
      if (terminals === null) return null;

      const coverage = baselineCoverage();
      const records: PhaseOneSourceRecord[] = [];
      const identifiers = configuration.knownDirectIdentifiers?.() ?? [];
      const claimsEncounter = claimsEncounterOutcome(
        terminals,
        identifiers,
        configuration.issueSourceReference,
      );
      if (claimsEncounter !== null) {
        coverage.encounter = claimsEncounter.coverage;
        records.push(...claimsEncounter.records);
      }
      for (const terminal of terminals) {
        const family = DATA_TYPE_TO_FAMILY[terminal.dataType];
        if (terminal.status === 'success') {
          const projected = projectSuccess(terminal, identifiers, configuration.issueSourceReference);
          if (projected.status === 'quarantined') {
            coverage[family] = {
              status: 'normalization-failure', recordCount: 0, reasonCode: projected.reasonCode,
            };
          } else {
            records.push(...projected.records);
            coverage[family] = projected.records.length === 0
              ? {status: 'confirmed-empty', recordCount: 0}
              : {status: 'has-data', recordCount: projected.records.length};
          }
        } else if (terminal.status === 'nodata') {
          coverage[family] = {status: 'confirmed-empty', recordCount: 0};
        } else if (terminal.status === 'unauthorized') {
          coverage[family] = {
            status: 'unauthorized', recordCount: 0, reasonCode: terminal.reasonCode,
          };
        } else {
          coverage[family] = {
            status: 'fetch-failure', recordCount: 0, reasonCode: terminal.reasonCode,
          };
        }
      }

      const sealed = sealVersionedPatientSnapshot({
        schemaVersion: 'patient-snapshot.v1', contractVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
        patientId: scope.patientId, sessionId: scope.sessionId, revision: scope.revision,
        capturedAt: configuration.now(), records, coverage,
      }, sealedBySession.get(scope.sessionId));
      if (sealed === null) return null;
      sealedBySession.set(scope.sessionId, sealed);

      const familyIndexes = new Map<PhaseOneSourceFamily, number>();
      return Object.freeze({
        sealed,
        sourceAliases: Object.freeze(sealed.snapshot.records.map((record) => {
          const index = (familyIndexes.get(record.sourceFamily) ?? 0) + 1;
          familyIndexes.set(record.sourceFamily, index);
          return Object.freeze({
            sourceRef: record.sourceRef, label: `${SOURCE_LABELS[record.sourceFamily]} ${index}`,
          });
        })),
      });
    },

    discardSession(sessionId: string): void {
      if (dataSessionIdSchema.safeParse(sessionId).success) sealedBySession.delete(sessionId);
    },
  });
}

/** Extracts only recognized terminal source envelopes; raw rows stay opaque. */
export function terminalClinicalResultsFromFetchEvent(value: unknown): unknown | null {
  return terminalResults(value) === null ? null : value;
}
