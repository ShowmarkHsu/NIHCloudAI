import {
  phaseOneSourceRecordSchema,
  type PhaseOneSourceRecord,
} from '../contracts/clinicalProjection';
import {
  patientSnapshotV1Schema,
  type PatientSnapshotV1,
} from '../contracts/patientSnapshot';
import {
  createSourceReferenceVault,
  sourceReferenceVaultSchema,
  sourceReferenceVaultScopeSchema,
  type SourceReferenceVault,
} from '../contracts/referenceVault';

export function createProjectionReferenceVault(
  scope: unknown,
  records: unknown,
): SourceReferenceVault | null {
  const parsedScope = sourceReferenceVaultScopeSchema.safeParse(scope);
  if (!parsedScope.success || !Array.isArray(records) || records.length > 5_000) return null;

  const familyIndexes = new Map<string, number>();
  const entries: {sourceRef: string; sourceFamily: PhaseOneSourceRecord['sourceFamily']; recordIndex: number}[] = [];
  for (const candidate of records) {
    const parsedRecord = phaseOneSourceRecordSchema.safeParse(candidate);
    if (!parsedRecord.success) return null;
    const recordIndex = familyIndexes.get(parsedRecord.data.sourceFamily) ?? 0;
    familyIndexes.set(parsedRecord.data.sourceFamily, recordIndex + 1);
    entries.push({
      sourceRef: parsedRecord.data.sourceRef,
      sourceFamily: parsedRecord.data.sourceFamily,
      recordIndex,
    });
  }

  return createSourceReferenceVault({scope: parsedScope.data, entries});
}

export type SealedPatientSnapshot = Readonly<{
  snapshot: PatientSnapshotV1;
  referenceVault: SourceReferenceVault;
}>;

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || visited.has(value)) {
    return value;
  }

  visited.add(value);
  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue, visited);
  }
  return Object.freeze(value);
}

function parseSealedPatientSnapshot(
  value: unknown,
): SealedPatientSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as {
    readonly snapshot?: unknown;
    readonly referenceVault?: unknown;
  };
  if (Object.keys(candidate).length !== 2) return null;

  const parsedSnapshot = patientSnapshotV1Schema.safeParse(candidate.snapshot);
  const parsedVault = sourceReferenceVaultSchema.safeParse(candidate.referenceVault);
  if (!parsedSnapshot.success || !parsedVault.success) return null;

  const expectedVault = createProjectionReferenceVault(
    {
      sessionId: parsedSnapshot.data.sessionId,
      revision: parsedSnapshot.data.revision,
      contractVersion: parsedSnapshot.data.contractVersion,
    },
    parsedSnapshot.data.records,
  );
  if (expectedVault === null) return null;

  if (
    JSON.stringify(parsedVault.data) !== JSON.stringify(expectedVault)
  ) {
    return null;
  }

  return deepFreeze({
    snapshot: parsedSnapshot.data,
    referenceVault: parsedVault.data,
  });
}

function sharesSourceReference(
  left: PatientSnapshotV1,
  right: PatientSnapshotV1,
): boolean {
  const sourceReferences = new Set(left.records.map((record) => record.sourceRef));
  return right.records.some((record) => sourceReferences.has(record.sourceRef));
}

export function sealVersionedPatientSnapshot(
  snapshot: unknown,
  previousSealedSnapshot?: unknown,
): SealedPatientSnapshot | null {
  const parsedSnapshot = patientSnapshotV1Schema.safeParse(snapshot);
  if (!parsedSnapshot.success) return null;

  const current = parsedSnapshot.data;
  const referenceVault = createProjectionReferenceVault(
    {
      sessionId: current.sessionId,
      revision: current.revision,
      contractVersion: current.contractVersion,
    },
    current.records,
  );
  if (referenceVault === null) return null;

  if (previousSealedSnapshot !== undefined) {
    const previous = parseSealedPatientSnapshot(previousSealedSnapshot);
    if (
      previous === null ||
      previous.snapshot.patientId !== current.patientId ||
      previous.snapshot.sessionId !== current.sessionId ||
      previous.snapshot.contractVersion !== current.contractVersion ||
      current.revision <= previous.snapshot.revision ||
      sharesSourceReference(previous.snapshot, current)
    ) {
      return null;
    }
  }

  return deepFreeze({snapshot: current, referenceVault});
}
