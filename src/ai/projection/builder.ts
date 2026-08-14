import { phaseOneSourceRecordSchema, type PhaseOneSourceRecord } from '../contracts/clinicalProjection';
import { createSourceReferenceVault, sourceReferenceVaultScopeSchema, type SourceReferenceVault } from '../contracts/referenceVault';

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
