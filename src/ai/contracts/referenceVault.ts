import { z } from 'zod';

import { type PhaseOneSourceFamily } from './coverage';
import {
  sourceReferenceSchema,
  type SourceReference,
} from './clinicalProjection';
import {
  clinicalProjectionContractVersionSchema,
  type ClinicalProjectionContractVersion,
} from './versions';
import {
  dataSessionIdSchema,
  snapshotRevisionSchema,
  type DataSessionId,
  type SnapshotRevision,
} from './patientSnapshot';

export const sourceReferenceVaultScopeSchema = z
  .object({
    sessionId: dataSessionIdSchema,
    revision: snapshotRevisionSchema,
    contractVersion: clinicalProjectionContractVersionSchema,
  })
  .strict()
  .readonly();

export const sourceReferenceVaultEntrySchema = z
  .object({
    sourceRef: sourceReferenceSchema,
    sourceFamily: z.enum([
      'encounter',
      'western-medication',
      'chinese-medication',
      'allergy',
      'lab',
      'imaging',
      'procedure',
      'discharge',
    ]),
    recordIndex: z.number().int().min(0).max(4_999),
  })
  .strict()
  .readonly();

const sourceReferenceVaultObjectSchema = z
  .object({
    scope: sourceReferenceVaultScopeSchema,
    entries: z.array(sourceReferenceVaultEntrySchema).max(5_000).readonly(),
  })
  .strict();

export const sourceReferenceVaultSchema = sourceReferenceVaultObjectSchema
  .superRefine((vault, context) => {
    const sourceRefs = new Set<string>();
    const recordLocations = new Set<string>();

    for (const [entryIndex, entry] of vault.entries.entries()) {
      if (sourceRefs.has(entry.sourceRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sourceRef must be unique within a reference vault',
          path: ['entries', entryIndex, 'sourceRef'],
        });
      }
      sourceRefs.add(entry.sourceRef);

      const location = `${entry.sourceFamily}:${entry.recordIndex}`;
      if (recordLocations.has(location)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'each source-family record index needs one reference',
          path: ['entries', entryIndex, 'recordIndex'],
        });
      }
      recordLocations.add(location);
    }
  })
  .readonly();

export type SourceReferenceVaultScope = z.infer<
  typeof sourceReferenceVaultScopeSchema
>;
export type SourceReferenceVaultEntry = z.infer<
  typeof sourceReferenceVaultEntrySchema
>;
export type SourceReferenceVault = z.infer<typeof sourceReferenceVaultSchema>;
export type SourceReferenceVaultLocator = Readonly<{
  sourceFamily: PhaseOneSourceFamily;
  recordIndex: number;
}>;

export function createSourceReferenceVault(
  value: unknown,
): SourceReferenceVault | null {
  const parsed = sourceReferenceVaultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function scopeMatches(
  left: SourceReferenceVaultScope,
  right: SourceReferenceVaultScope,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.revision === right.revision &&
    left.contractVersion === right.contractVersion
  );
}

export function resolveVaultReference(
  vault: unknown,
  sourceRef: unknown,
  scope: unknown,
): SourceReferenceVaultLocator | null {
  const parsedVault = sourceReferenceVaultSchema.safeParse(vault);
  const parsedSourceRef = sourceReferenceSchema.safeParse(sourceRef);
  const parsedScope = sourceReferenceVaultScopeSchema.safeParse(scope);
  if (
    !parsedVault.success ||
    !parsedSourceRef.success ||
    !parsedScope.success ||
    !scopeMatches(parsedVault.data.scope, parsedScope.data)
  ) {
    return null;
  }

  const entry = parsedVault.data.entries.find(
    (candidate) => candidate.sourceRef === parsedSourceRef.data,
  );
  if (entry === undefined) return null;

  return Object.freeze({
    sourceFamily: entry.sourceFamily,
    recordIndex: entry.recordIndex,
  });
}

export function acceptOpaqueSourceReference(value: unknown): SourceReference | null {
  const parsed = sourceReferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type ReferenceVaultSessionId = DataSessionId;
export type ReferenceVaultRevision = SnapshotRevision;
export type ReferenceVaultContractVersion = ClinicalProjectionContractVersion;
