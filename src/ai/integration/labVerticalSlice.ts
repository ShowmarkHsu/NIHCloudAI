import { z } from 'zod';

import {
  CLINICAL_PROJECTION_CONTRACT_VERSION,
  type PhaseOneSourceRecord,
} from '../contracts/clinicalProjection';
import { type SnapshotCoverage } from '../contracts/coverage';
import {
  dataSessionIdSchema,
  opaquePatientIdSchema,
  snapshotRevisionSchema,
} from '../contracts/patientSnapshot';
import { type SealedPatientSnapshot, sealVersionedPatientSnapshot } from '../projection/builder';
import { projectLabSourceFamily } from '../projection/sources/lab';

export type LabVerticalSliceScope = Readonly<{
  patientId: string;
  sessionId: string;
  revision: number;
}>;

export type LabVerticalSliceResult = Readonly<{
  sealed: SealedPatientSnapshot;
  sourceAliases: readonly Readonly<{
    sourceRef: string;
    label: string;
  }>[];
}>;

export type LabVerticalSliceConfiguration = Readonly<{
  now: () => string;
  issueSourceReference: () => unknown;
}>;

const rawLabEnvelopeSchema = z.object({
  rObject: z.array(z.unknown()).max(5_000),
}).strict();

const terminalLabResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    dataType: z.literal('labdata'),
    data: rawLabEnvelopeSchema,
    recordCount: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    status: z.literal('nodata'),
    dataType: z.literal('labdata'),
    recordCount: z.literal(0),
    data: rawLabEnvelopeSchema.optional(),
  }).strict(),
  z.object({
    status: z.literal('failure'),
    dataType: z.literal('labdata'),
    reasonCode: z.enum(['SOURCE_REQUEST_FAILED', 'SOURCE_TIMEOUT']),
  }).strict(),
]);

type NormalizedLab = Readonly<{
  date: string;
  facility: string;
  itemCode: string;
  itemName: string;
  sourceValue: string;
  normalizedValue: number | null;
  unit: string | null;
  sourceReferenceRange: string | null;
  sourceAbnormalFlag: 'normal' | 'high' | 'low' | 'abnormal' | 'critical' | null;
}>;

function ownString(record: Record<string, unknown>, key: string): string | null {
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  return typeof value === 'string' ? value.normalize('NFKC').trim() : null;
}

function ownOptionalString(record: Record<string, unknown>, key: string): string | null {
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  if (value === null || value === '') return null;
  return typeof value === 'string' ? value.normalize('NFKC').trim() || null : null;
}

function localDate(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/u.exec(value);
  if (match === null) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return z.string().date().safeParse(date).success ? date : null;
}

function sourceAbnormalFlag(value: string | null): NormalizedLab['sourceAbnormalFlag'] {
  switch (value?.toUpperCase()) {
    case '0':
    case 'N':
    case 'NORMAL':
      return 'normal';
    case 'H':
    case 'HIGH':
      return 'high';
    case 'L':
    case 'LOW':
      return 'low';
    case 'A':
    case 'ABNORMAL':
      return 'abnormal';
    case 'C':
    case 'CRITICAL':
      return 'critical';
    default:
      return null;
  }
}

/**
 * Maps the existing upstream terminal lab row into the small, closed adapter
 * input. It deliberately copies no IDs, URLs, diagnoses, notes, or unknown
 * fields, and it does not reuse any display grouping or user-configured range.
 */
function normalizeUpstreamLabRow(value: unknown): NormalizedLab | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null) {
    return null;
  }
  const date = localDate(ownString(record, 'real_inspect_date') ?? ownString(record, 'recipe_date'));
  const facility = ownString(record, 'hosp')?.split(';', 1)[0]?.trim() ?? null;
  const itemCode = ownString(record, 'order_code');
  const itemName = ownString(record, 'assay_item_name');
  const sourceValue = ownString(record, 'assay_value');
  if (date === null || facility === null || itemCode === null || itemName === null || sourceValue === null) {
    return null;
  }
  const numeric = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(sourceValue)
    ? Number(sourceValue)
    : null;
  return Object.freeze({
    date,
    facility,
    itemCode,
    itemName,
    sourceValue,
    normalizedValue: numeric !== null && Number.isFinite(numeric) ? numeric : null,
    unit: ownOptionalString(record, 'unit_data'),
    sourceReferenceRange: ownOptionalString(record, 'consult_value'),
    sourceAbnormalFlag: sourceAbnormalFlag(ownOptionalString(record, 'assay_mark')),
  });
}

function baselineCoverage(): SnapshotCoverage {
  const notCollected = {status: 'not-collected' as const, recordCount: 0 as const, reasonCode: 'SOURCE_NOT_COLLECTED' as const};
  const outOfScope = {status: 'out-of-scope' as const, recordCount: 0 as const, reasonCode: 'SOURCE_NOT_IN_CONTRACT' as const};
  return {
    encounter: {...notCollected},
    'western-medication': {...notCollected},
    'chinese-medication': {...notCollected},
    allergy: {...notCollected},
    lab: {...notCollected},
    imaging: {...notCollected},
    procedure: {...notCollected},
    discharge: {...notCollected},
    'adult-health-check': {...outOfScope},
    'cancer-screening': {...outOfScope},
    'hepatitis-bc': {...outOfScope},
    'ckm-derived': {...outOfScope},
  };
}

type MutableCoverage = {-readonly [Key in keyof SnapshotCoverage]: SnapshotCoverage[Key]};

function assertScope(scope: LabVerticalSliceScope): void {
  if (!opaquePatientIdSchema.safeParse(scope.patientId).success ||
    !dataSessionIdSchema.safeParse(scope.sessionId).success ||
    !snapshotRevisionSchema.safeParse(scope.revision).success) {
    throw new RangeError('lab vertical slice requires a closed patient/session/revision scope');
  }
}

/**
 * The R1 deep module. Its sole caller supplies a terminal upstream lab result
 * and an opaque session scope; normalization, quarantine, coverage, aliases,
 * revision continuity, vault construction, and sealing remain internal.
 */
export function createLabVerticalSlice(configuration: LabVerticalSliceConfiguration) {
  const sealedBySession = new Map<string, SealedPatientSnapshot>();

  return Object.freeze({
    ingest(scope: LabVerticalSliceScope, terminalResult: unknown): LabVerticalSliceResult | null {
      assertScope(scope);
      const terminal = terminalLabResultSchema.safeParse(terminalResult);
      if (!terminal.success) return null;

      const coverage: MutableCoverage = baselineCoverage();
      let records: readonly PhaseOneSourceRecord[] = [];
      if (terminal.data.status === 'success') {
        const normalized = terminal.data.data.rObject.map(normalizeUpstreamLabRow);
        if (normalized.some((row) => row === null)) {
          coverage.lab = {status: 'normalization-failure', recordCount: 0, reasonCode: 'SOURCE_SCHEMA_REJECTED'};
        } else {
          const projection = projectLabSourceFamily(normalized, [], configuration.issueSourceReference);
          if (projection.status === 'quarantined') {
            coverage.lab = {status: 'normalization-failure', recordCount: 0, reasonCode: projection.reasonCode};
          } else {
            records = projection.records;
            coverage.lab = records.length === 0
              ? {status: 'confirmed-empty', recordCount: 0}
              : {status: 'has-data', recordCount: records.length};
          }
        }
      } else if (terminal.data.status === 'nodata') {
        coverage.lab = {status: 'confirmed-empty', recordCount: 0};
      } else {
        coverage.lab = {status: 'fetch-failure', recordCount: 0, reasonCode: terminal.data.reasonCode};
      }

      const previous = sealedBySession.get(scope.sessionId);
      const sealed = sealVersionedPatientSnapshot({
        schemaVersion: 'patient-snapshot.v1',
        contractVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
        patientId: scope.patientId,
        sessionId: scope.sessionId,
        revision: scope.revision,
        capturedAt: configuration.now(),
        records,
        coverage,
      }, previous);
      if (sealed === null) return null;
      sealedBySession.set(scope.sessionId, sealed);

      return Object.freeze({
        sealed,
        sourceAliases: Object.freeze(sealed.snapshot.records.map((record, index) => Object.freeze({
          sourceRef: record.sourceRef,
          label: `檢驗來源 ${index + 1}`,
        }))),
      });
    },

    discardSession(sessionId: string): void {
      if (dataSessionIdSchema.safeParse(sessionId).success) sealedBySession.delete(sessionId);
    },
  });
}

/** Extracts only the legacy terminal lab envelope; it never exposes a row. */
export function terminalLabResultFromFetchEvent(value: unknown): unknown | null {
  if (!Array.isArray(value)) return null;
  const result = value.find((candidate) =>
    typeof candidate === 'object' && candidate !== null &&
    Reflect.get(candidate, 'dataType') === 'labdata',
  );
  if (result === undefined || typeof result !== 'object' || result === null) return null;
  const status = Reflect.get(result, 'status');
  if (status === 'success' || status === 'nodata') return result;
  return null;
}
