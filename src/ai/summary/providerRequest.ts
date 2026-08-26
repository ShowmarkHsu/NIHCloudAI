import { z } from 'zod';

import {
  FIXED_FIVE_SECTION_HEADINGS,
  FIXED_FIVE_SECTION_SCHEMA_VERSION,
  FIXED_FIVE_SECTION_TIME_WINDOWS,
  classifyFixedFiveSectionContentFailure,
  classifyMissingAsNegativeFinding,
  fixedFiveSectionSummarySchema,
  type FixedFiveSectionSummary,
} from '../contracts/summary';
import type { SnapshotCoverage } from '../contracts/coverage';
import { type SealedPatientSnapshot, sealVersionedPatientSnapshot } from '../projection/builder';
import { FIXED_FIVE_SECTION_COVERAGE_POLICY } from '../providers/prompt';
import {
  renderDeterministicCoverageSections,
  type CoverageRenderableSection,
} from './coverageRenderer';
import type { SummaryReviewScopeInput } from './stateMachine';

const sourceAliasSchema = z.string().regex(/^S[1-9]\d{0,3}$/);
const sealedSummaryRequestBrand = Symbol('sealed-summary-request');

const providerSectionSchema = z.object({
  heading: z.enum(FIXED_FIVE_SECTION_HEADINGS),
  content: z.string(),
  sourceAliases: z.array(sourceAliasSchema).max(100),
}).strict();

const providerSummarySchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_SECTION_SCHEMA_VERSION),
  timeWindows: z.object({
    medicationsAndAllergies: z.literal(FIXED_FIVE_SECTION_TIME_WINDOWS.medicationsAndAllergies),
    recentCourseAndTests: z.literal(FIXED_FIVE_SECTION_TIME_WINDOWS.recentCourseAndTests),
    admissionsProceduresAndDischarge: z.literal(FIXED_FIVE_SECTION_TIME_WINDOWS.admissionsProceduresAndDischarge),
  }).strict(),
  sections: z.tuple([
    providerSectionSchema.extend({heading: z.literal(FIXED_FIVE_SECTION_HEADINGS[0])}),
    providerSectionSchema.extend({heading: z.literal(FIXED_FIVE_SECTION_HEADINGS[1])}),
    providerSectionSchema.extend({heading: z.literal(FIXED_FIVE_SECTION_HEADINGS[2])}),
    providerSectionSchema.extend({heading: z.literal(FIXED_FIVE_SECTION_HEADINGS[3])}),
    providerSectionSchema.extend({heading: z.literal(FIXED_FIVE_SECTION_HEADINGS[4])}),
  ]),
}).strict();

const providerSectionJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: Object.freeze({
    heading: Object.freeze({type: 'string', enum: FIXED_FIVE_SECTION_HEADINGS}),
    content: Object.freeze({
      type: 'string',
      description: '只寫 has-data 臨床事實，不得包含任何來源代號。local-rendered coverage 不得由 Provider 描述；沒有 has-data facts 或資料缺口 section 可輸出空字串。本機將依 sealed coverage 產生固定文字。',
    }),
    sourceAliases: Object.freeze({
      type: 'array',
      items: Object.freeze({type: 'string'}),
    }),
  }),
  required: Object.freeze(['heading', 'content', 'sourceAliases']),
});

/**
 * OpenRouter-compatible structural constraint. The local Zod contract remains
 * authoritative for section order, wording, character limits, and aliases.
 */
export const FIXED_FIVE_SECTION_PROVIDER_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: Object.freeze({
    schemaVersion: Object.freeze({
      type: 'string',
      enum: Object.freeze([FIXED_FIVE_SECTION_SCHEMA_VERSION]),
    }),
    timeWindows: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: Object.freeze({
        medicationsAndAllergies: Object.freeze({
          type: 'string',
          enum: Object.freeze([FIXED_FIVE_SECTION_TIME_WINDOWS.medicationsAndAllergies]),
        }),
        recentCourseAndTests: Object.freeze({
          type: 'string',
          enum: Object.freeze([FIXED_FIVE_SECTION_TIME_WINDOWS.recentCourseAndTests]),
        }),
        admissionsProceduresAndDischarge: Object.freeze({
          type: 'string',
          enum: Object.freeze([FIXED_FIVE_SECTION_TIME_WINDOWS.admissionsProceduresAndDischarge]),
        }),
      }),
      required: Object.freeze([
        'medicationsAndAllergies',
        'recentCourseAndTests',
        'admissionsProceduresAndDischarge',
      ]),
    }),
    sections: Object.freeze({
      type: 'array',
      items: providerSectionJsonSchema,
      minItems: 5,
      maxItems: 5,
    }),
  }),
  required: Object.freeze(['schemaVersion', 'timeWindows', 'sections']),
});

export type SealedSummaryRequest = Readonly<{
  scope: SummaryReviewScopeInput;
  prompt: string;
  coverage: SnapshotCoverage;
  sourceAliases: Readonly<Record<string, string>>;
}> & Readonly<{[sealedSummaryRequestBrand]: true}>;

function sameScope(scope: SummaryReviewScopeInput, sealed: SealedPatientSnapshot): boolean {
  return scope.patientId === sealed.snapshot.patientId &&
    scope.sessionId === sealed.snapshot.sessionId &&
    scope.revision === sealed.snapshot.revision &&
    scope.contractVersion === sealed.snapshot.contractVersion;
}

/**
 * Converts a sealed local snapshot into the only provider-ready shape. Patient
 * and session identifiers never enter the prompt, and records are represented
 * with short aliases that can be validated back through the local vault.
 */
export function createSealedSummaryRequest(
  scope: SummaryReviewScopeInput,
  sealedInput: unknown,
): SealedSummaryRequest | null {
  if (typeof sealedInput !== 'object' || sealedInput === null) return null;
  const sealed = sealedInput as SealedPatientSnapshot;
  const rebuilt = sealVersionedPatientSnapshot(sealed.snapshot);
  if (rebuilt === null || JSON.stringify(rebuilt.referenceVault) !== JSON.stringify(sealed.referenceVault) || !sameScope(scope, rebuilt)) {
    return null;
  }

  const sourceAliases = Object.fromEntries(rebuilt.snapshot.records.map((record, index) => [
    `S${index + 1}`, record.sourceRef,
  ]));
  const facts = rebuilt.snapshot.records.map((record, index) => {
    const {sourceRef: _sourceRef, ...clinicalFact} = record;
    return {sourceAlias: `S${index + 1}`, ...clinicalFact};
  });
  const prompt = '請只輸出 JSON；每節使用 sourceAliases（S1…），不得輸出 sourceRefs。\n' +
    JSON.stringify({
      coveragePolicy: FIXED_FIVE_SECTION_COVERAGE_POLICY,
      coverage: rebuilt.snapshot.coverage,
      facts,
    });
  return Object.freeze({
    scope: Object.freeze({...scope}),
    prompt,
    coverage: rebuilt.snapshot.coverage,
    sourceAliases: Object.freeze(sourceAliases),
    [sealedSummaryRequestBrand]: true as const,
  });
}

export function isSealedSummaryRequest(value: unknown): value is SealedSummaryRequest {
  return typeof value === 'object' && value !== null &&
    Reflect.get(value, sealedSummaryRequestBrand) === true;
}

export type ProviderSummaryOutputResult =
  | Readonly<{status: 'completed'; summary: FixedFiveSectionSummary}>
  | Readonly<{status: 'validation-structure-failed' | 'validation-alias-failed' | 'validation-content-failed' | 'validation-content-metadata-failed' | 'validation-content-negative-failed' | 'validation-content-negative-not-found-failed' | 'validation-content-negative-normal-failed' | 'validation-content-negative-none-word-failed' | 'validation-content-data-gap-failed' | 'validation-content-bounds-failed' | 'validation-length-failed'}>;

function isAliasIssuePath(path: readonly PropertyKey[]): boolean {
  const sourceAliasesIndex = path.indexOf('sourceAliases');
  return sourceAliasesIndex >= 0 && typeof path[sourceAliasesIndex + 1] === 'number';
}

const declaredAliasCitationPattern = /\bS[1-9]\d{0,3}\b/gu;

function canonicalizeDeclaredAliasCitations(
  section: CoverageRenderableSection,
  knownAliases: Readonly<Record<string, string>>,
): CoverageRenderableSection {
  const contentAliases = [...section.content.matchAll(declaredAliasCitationPattern)]
    .map((match) => match[0]);
  if (
    contentAliases.length === 0 ||
    contentAliases.some((alias) =>
      !section.sourceAliases.includes(alias) || knownAliases[alias] === undefined)
  ) return section;
  return Object.freeze({
    heading: section.heading,
    content: section.content.replace(declaredAliasCitationPattern, ''),
    sourceAliases: section.sourceAliases,
  });
}

/**
 * Classifies only a bounded validation stage. It never returns parsed provider
 * output, Zod issues, aliases, character counts, or any other response detail.
 */
export function validateProviderSummaryOutput(
  output: unknown,
  request: SealedSummaryRequest,
): ProviderSummaryOutputResult {
  if (typeof output !== 'string') return {status: 'validation-structure-failed'};
  let document: unknown;
  try {
    document = JSON.parse(output);
  } catch {
    return {status: 'validation-structure-failed'};
  }

  const parsed = providerSummarySchema.safeParse(document);
  if (!parsed.success) {
    return parsed.error.issues.some((issue) => isAliasIssuePath(issue.path))
      ? {status: 'validation-alias-failed'}
      : {status: 'validation-structure-failed'};
  }

  const renderedSections = renderDeterministicCoverageSections(
    parsed.data.sections,
    request.coverage,
  );
  const canonicalizedSections = renderedSections.map((section) =>
    canonicalizeDeclaredAliasCitations(section, request.sourceAliases));
  const sections = canonicalizedSections.map((section) => {
    const sourceRefs = section.sourceAliases.map((alias) => request.sourceAliases[alias]);
    return {heading: section.heading, content: section.content, sourceRefs};
  });
  if (sections.some((section) => section.sourceRefs.some((sourceRef) => sourceRef === undefined))) {
    return {status: 'validation-alias-failed'};
  }

  const summary = fixedFiveSectionSummarySchema.safeParse({...parsed.data, sections});
  if (!summary.success) {
    const onlyLengthFailure = summary.error.issues.every((issue) =>
      issue.path.length === 1 && issue.path[0] === 'sections');
    if (onlyLengthFailure) return {status: 'validation-length-failed'};
    const contentFailure = classifyFixedFiveSectionContentFailure(summary.error.issues);
    if (contentFailure === 'metadata') return {status: 'validation-content-metadata-failed'};
    if (contentFailure === 'negative-finding') {
      const negativeKind = parsed.data.sections
        .map((section) => classifyMissingAsNegativeFinding(section.content))
        .find((kind) => kind !== null);
      if (negativeKind === 'not-found') return {status: 'validation-content-negative-not-found-failed'};
      if (negativeKind === 'normal') return {status: 'validation-content-negative-normal-failed'};
      if (negativeKind === 'none-word') return {status: 'validation-content-negative-none-word-failed'};
      return {status: 'validation-content-negative-failed'};
    }
    if (contentFailure === 'data-gap-wording') return {status: 'validation-content-data-gap-failed'};
    if (contentFailure === 'field-bounds') return {status: 'validation-content-bounds-failed'};
    return {status: 'validation-content-failed'};
  }
  return {status: 'completed', summary: summary.data};
}

/** Fails closed unless a complete provider JSON document maps to local aliases. */
export function parseProviderSummaryOutput(
  output: unknown,
  request: SealedSummaryRequest,
): FixedFiveSectionSummary | null {
  const result = validateProviderSummaryOutput(output, request);
  return result.status === 'completed' ? result.summary : null;
}
