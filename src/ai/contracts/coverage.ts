import { z } from 'zod';

export const PHASE_ONE_SOURCE_FAMILIES = [
  'encounter',
  'western-medication',
  'chinese-medication',
  'allergy',
  'lab',
  'imaging',
  'procedure',
  'discharge',
] as const;

export const OUT_OF_SCOPE_COVERAGE_FAMILIES = [
  'adult-health-check',
  'cancer-screening',
  'hepatitis-bc',
  'ckm-derived',
] as const;

export const COVERAGE_TERMINAL_STATES = [
  'has-data',
  'confirmed-empty',
  'unauthorized',
  'fetch-failure',
  'normalization-failure',
  'out-of-scope',
] as const;

export const phaseOneSourceFamilySchema = z.enum(PHASE_ONE_SOURCE_FAMILIES);
export const outOfScopeCoverageFamilySchema = z.enum(
  OUT_OF_SCOPE_COVERAGE_FAMILIES,
);
export const coverageTerminalStateSchema = z.enum(COVERAGE_TERMINAL_STATES);

const hasDataCoverageObjectSchema = z
  .object({
    status: z.literal('has-data'),
    recordCount: z.number().int().positive().max(5_000),
  })
  .strict();

const confirmedEmptyCoverageObjectSchema = z
  .object({
    status: z.literal('confirmed-empty'),
    recordCount: z.literal(0),
  })
  .strict();

const unauthorizedCoverageObjectSchema = z
  .object({
    status: z.literal('unauthorized'),
    recordCount: z.literal(0),
    reasonCode: z.literal('SOURCE_UNAUTHORIZED'),
  })
  .strict();

const fetchFailureCoverageObjectSchema = z
  .object({
    status: z.literal('fetch-failure'),
    recordCount: z.literal(0),
    reasonCode: z.enum(['SOURCE_REQUEST_FAILED', 'SOURCE_TIMEOUT']),
  })
  .strict();

const normalizationFailureCoverageObjectSchema = z
  .object({
    status: z.literal('normalization-failure'),
    recordCount: z.literal(0),
    reasonCode: z.enum([
      'SOURCE_SCHEMA_REJECTED',
      'SOURCE_IDENTITY_TAINT',
      'SOURCE_TEXT_SANITIZATION_FAILED',
    ]),
  })
  .strict();

const outOfScopeCoverageObjectSchema = z
  .object({
    status: z.literal('out-of-scope'),
    recordCount: z.literal(0),
    reasonCode: z.literal('SOURCE_NOT_IN_CONTRACT'),
  })
  .strict();

export const phaseOneCoverageSchema = z
  .discriminatedUnion('status', [
    hasDataCoverageObjectSchema,
    confirmedEmptyCoverageObjectSchema,
    unauthorizedCoverageObjectSchema,
    fetchFailureCoverageObjectSchema,
    normalizationFailureCoverageObjectSchema,
  ])
  .readonly();

export const phaseTwoCoverageSchema = outOfScopeCoverageObjectSchema.readonly();

export const snapshotCoverageSchema = z
  .object({
    encounter: phaseOneCoverageSchema,
    'western-medication': phaseOneCoverageSchema,
    'chinese-medication': phaseOneCoverageSchema,
    allergy: phaseOneCoverageSchema,
    lab: phaseOneCoverageSchema,
    imaging: phaseOneCoverageSchema,
    procedure: phaseOneCoverageSchema,
    discharge: phaseOneCoverageSchema,
    'adult-health-check': phaseTwoCoverageSchema,
    'cancer-screening': phaseTwoCoverageSchema,
    'hepatitis-bc': phaseTwoCoverageSchema,
    'ckm-derived': phaseTwoCoverageSchema,
  })
  .strict()
  .readonly();

export type PhaseOneSourceFamily = z.infer<typeof phaseOneSourceFamilySchema>;
export type OutOfScopeCoverageFamily = z.infer<
  typeof outOfScopeCoverageFamilySchema
>;
export type CoverageTerminalState = z.infer<typeof coverageTerminalStateSchema>;
export type PhaseOneCoverage = z.infer<typeof phaseOneCoverageSchema>;
export type PhaseTwoCoverage = z.infer<typeof phaseTwoCoverageSchema>;
export type SnapshotCoverage = z.infer<typeof snapshotCoverageSchema>;
