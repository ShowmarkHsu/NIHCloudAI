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
      minLength: 30,
      maxLength: 65,
      description: '30–65 字。只寫 has-data 臨床事實且不得包含來源代號；local-rendered 的無 facts 或資料缺口 section 使用指定中性占位，本機將完整丟棄並依 sealed coverage 取代。',
    }),
    sourceAliases: Object.freeze({
      type: 'array',
      items: Object.freeze({type: 'string'}),
      maxItems: 20,
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
  sourceEvidence: Readonly<Record<string,
    'source-stated-no-known-allergy' | 'source-stated-present-allergy'>>;
  sourceContainsNoneWord: Readonly<Record<string, boolean>>;
}> & Readonly<{[sealedSummaryRequestBrand]: true}>;

type ProviderFactRow = Readonly<{
  sourceAlias: string;
  fact: Readonly<Record<string, unknown>>;
}>;

function createProviderFactTables(
  records: SealedPatientSnapshot['snapshot']['records'],
): readonly Readonly<{
  sourceFamily: string;
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
}>[] {
  const grouped = new Map<string, ProviderFactRow[]>();
  for (const [index, record] of records.entries()) {
    const {sourceRef: _sourceRef, sourceFamily, ...fact} = record;
    const rows = grouped.get(sourceFamily) ?? [];
    rows.push({sourceAlias: `S${index + 1}`, fact});
    grouped.set(sourceFamily, rows);
  }
  return Object.freeze([...grouped.entries()].map(([sourceFamily, facts]) => {
    const factColumns = [...new Set(facts.flatMap(({fact}) => Object.keys(fact)))];
    const columns = Object.freeze(['sourceAlias', ...factColumns]);
    const rows = Object.freeze(facts.map(({sourceAlias, fact}) => Object.freeze([
      sourceAlias,
      ...factColumns.map((column) => fact[column] ?? null),
    ])));
    return Object.freeze({sourceFamily, columns, rows});
  }));
}

function containsNoneWord(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('無');
  if (Array.isArray(value)) return value.some(containsNoneWord);
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some(containsNoneWord);
}

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
  const sourceEvidence = Object.fromEntries(rebuilt.snapshot.records.flatMap((record, index) => {
    if (record.sourceFamily !== 'allergy') return [];
    return [[
      `S${index + 1}`,
      record.status === 'no-known-allergy'
        ? 'source-stated-no-known-allergy' as const
        : 'source-stated-present-allergy' as const,
    ]];
  }));
  const sourceContainsNoneWord = Object.fromEntries(rebuilt.snapshot.records.map((record, index) => [
    `S${index + 1}`,
    containsNoneWord(record),
  ]));
  const factTables = createProviderFactTables(rebuilt.snapshot.records);
  const prompt = '請只輸出 JSON；每節使用 sourceAliases（S1…），不得輸出 sourceRefs。factTables 的 columns 依序對應每列 rows 的值。\n' +
    JSON.stringify({
      coveragePolicy: FIXED_FIVE_SECTION_COVERAGE_POLICY,
      coverage: rebuilt.snapshot.coverage,
      factTables,
    });
  return Object.freeze({
    scope: Object.freeze({...scope}),
    prompt,
    coverage: rebuilt.snapshot.coverage,
    sourceAliases: Object.freeze(sourceAliases),
    sourceEvidence: Object.freeze(sourceEvidence),
    sourceContainsNoneWord: Object.freeze(sourceContainsNoneWord),
    [sealedSummaryRequestBrand]: true as const,
  });
}

export function isSealedSummaryRequest(value: unknown): value is SealedSummaryRequest {
  return typeof value === 'object' && value !== null &&
    Reflect.get(value, sealedSummaryRequestBrand) === true;
}

export type ProviderSummaryOutputResult =
  | Readonly<{status: 'completed'; summary: FixedFiveSectionSummary}>
  | Readonly<{status: 'validation-structure-failed' | 'validation-alias-failed' | 'validation-content-failed' | 'validation-content-metadata-failed' | 'validation-content-negative-failed' | 'validation-content-negative-not-found-failed' | 'validation-content-negative-normal-failed' | 'validation-content-negative-none-word-failed' | 'validation-content-negative-none-word-outside-supported-sections-failed' | 'validation-content-negative-none-word-recent-course-source-supported-failed' | 'validation-content-negative-none-word-recent-course-source-unsupported-failed' | 'validation-content-negative-none-word-admission-source-supported-failed' | 'validation-content-negative-none-word-admission-source-unsupported-failed' | 'validation-content-negative-none-word-data-gap-source-supported-failed' | 'validation-content-negative-none-word-data-gap-source-unsupported-failed' | 'validation-content-negative-none-word-multiple-failed' | 'validation-content-negative-none-word-unrelated-to-allergy-failed' | 'validation-content-negative-none-word-allergy-source-unsupported-failed' | 'validation-content-negative-none-word-allergy-phrase-unsupported-failed' | 'validation-content-data-gap-failed' | 'validation-content-bounds-failed' | 'validation-length-failed'}>;

function isAliasIssuePath(path: readonly PropertyKey[]): boolean {
  const sourceAliasesIndex = path.indexOf('sourceAliases');
  return sourceAliasesIndex >= 0 && typeof path[sourceAliasesIndex + 1] === 'number';
}

const declaredAliasCitationPattern = /\bS[1-9]\d{0,3}\b/gu;
const noneBeforeAllergyPhrasePattern =
  /無([^，；。無]{0,6})過敏(?:紀錄|記錄|史|資料|資訊)?/gu;
const allergyBeforeNonePhrasePattern =
  /過敏(?:紀錄|記錄|史|資料|資訊)?(?:顯示|為|：|:)?無(?:相關)?(?:紀錄|記錄|資料|資訊)?/gu;
const unsupportedAllergyQualifierPattern =
  /(?:及|與|或|、|和|以及|疾病|症狀|檢驗|影像|手術|住院|出院|處置|就醫)/u;
const canonicalNoKnownAllergyWording = '來源明示未有已知過敏紀錄';
const canonicalConflictingAllergyWording =
  '來源同時明示過敏與未有已知過敏紀錄，資料可能矛盾，須逐項人工核對';

function canonicalizeSourceStatedNoKnownAllergy(
  section: CoverageRenderableSection,
  sourceEvidence: SealedSummaryRequest['sourceEvidence'],
): CoverageRenderableSection {
  if (!section.content.includes('無') ||
    (section.heading !== FIXED_FIVE_SECTION_HEADINGS[0] &&
      section.heading !== FIXED_FIVE_SECTION_HEADINGS[1])) return section;

  const noKnownAliases = Object.entries(sourceEvidence)
    .filter(([, evidence]) => evidence === 'source-stated-no-known-allergy')
    .map(([alias]) => alias);
  if (noKnownAliases.length === 0) return section;
  const presentAliases = Object.entries(sourceEvidence)
    .filter(([, evidence]) => evidence === 'source-stated-present-allergy')
    .map(([alias]) => alias);
  const fixedWording = presentAliases.length > 0
    ? canonicalConflictingAllergyWording
    : canonicalNoKnownAllergyWording;

  if ((section.content.match(/無/gu)?.length ?? 0) !== 1) return section;
  let replacementCount = 0;
  const noneBeforeCanonicalized = section.content.replace(
    noneBeforeAllergyPhrasePattern,
    (phrase, qualifier: string) => {
      if (unsupportedAllergyQualifierPattern.test(qualifier)) return phrase;
      replacementCount += 1;
      return fixedWording;
    },
  );
  const content = noneBeforeCanonicalized.replace(allergyBeforeNonePhrasePattern, () => {
    replacementCount += 1;
    return fixedWording;
  });
  if (replacementCount !== 1 || content.includes('無')) return section;
  const sourceAliases = [...new Set([
    ...section.sourceAliases,
    ...noKnownAliases,
    ...(presentAliases.length > 0 ? presentAliases : []),
  ])];
  if (sourceAliases.length > 100) return section;
  return Object.freeze({
    heading: section.heading,
    content,
    sourceAliases: Object.freeze(sourceAliases),
  });
}

type NoneWordFailureStatus = Exclude<
  ProviderSummaryOutputResult,
  Readonly<{status: 'completed'; summary: FixedFiveSectionSummary}>
>['status'];

function classifyNoneWordFailure(
  sections: readonly CoverageRenderableSection[],
  sourceEvidence: SealedSummaryRequest['sourceEvidence'],
  sourceContainsNoneWord: SealedSummaryRequest['sourceContainsNoneWord'],
): NoneWordFailureStatus {
  const failingSection = sections.find((section) =>
    section.content.replaceAll('無可用資料', '').includes('無'));
  if (failingSection === undefined) return 'validation-content-negative-none-word-failed';
  const sectionIndex = FIXED_FIVE_SECTION_HEADINGS.indexOf(
    failingSection.heading as typeof FIXED_FIVE_SECTION_HEADINGS[number],
  );
  if (sectionIndex >= 2) {
    const citedSourceSupportsNoneWord = failingSection.sourceAliases.some(
      (alias) => sourceContainsNoneWord[alias] === true,
    );
    if (sectionIndex === 2) {
      return citedSourceSupportsNoneWord
        ? 'validation-content-negative-none-word-recent-course-source-supported-failed'
        : 'validation-content-negative-none-word-recent-course-source-unsupported-failed';
    }
    if (sectionIndex === 3) {
      return citedSourceSupportsNoneWord
        ? 'validation-content-negative-none-word-admission-source-supported-failed'
        : 'validation-content-negative-none-word-admission-source-unsupported-failed';
    }
    if (sectionIndex === 4) {
      return citedSourceSupportsNoneWord
        ? 'validation-content-negative-none-word-data-gap-source-supported-failed'
        : 'validation-content-negative-none-word-data-gap-source-unsupported-failed';
    }
    return 'validation-content-negative-none-word-outside-supported-sections-failed';
  }
  const content = failingSection.content.replaceAll('無可用資料', '');
  if ((content.match(/無/gu)?.length ?? 0) !== 1) {
    return 'validation-content-negative-none-word-multiple-failed';
  }
  if (!content.includes('過敏')) {
    return 'validation-content-negative-none-word-unrelated-to-allergy-failed';
  }
  if (!Object.values(sourceEvidence).includes('source-stated-no-known-allergy')) {
    return 'validation-content-negative-none-word-allergy-source-unsupported-failed';
  }
  return 'validation-content-negative-none-word-allergy-phrase-unsupported-failed';
}

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

  const evidenceCanonicalizedSections = parsed.data.sections.map((section) =>
    canonicalizeSourceStatedNoKnownAllergy(section, request.sourceEvidence));
  const renderedSections = renderDeterministicCoverageSections(
    evidenceCanonicalizedSections,
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
      const negativeKind = sections
        .map((section) => classifyMissingAsNegativeFinding(section.content))
        .find((kind) => kind !== null);
      if (negativeKind === 'not-found') return {status: 'validation-content-negative-not-found-failed'};
      if (negativeKind === 'normal') return {status: 'validation-content-negative-normal-failed'};
      if (negativeKind === 'none-word') {
        return {status: classifyNoneWordFailure(
          canonicalizedSections,
          request.sourceEvidence,
          request.sourceContainsNoneWord,
        )};
      }
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
