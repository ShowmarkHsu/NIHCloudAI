import { z } from 'zod';

import {
  FIXED_FIVE_SECTION_HEADINGS,
  FIXED_FIVE_SECTION_SCHEMA_VERSION,
  FIXED_FIVE_SECTION_TIME_WINDOWS,
  fixedFiveSectionSummarySchema,
  type FixedFiveSectionSummary,
} from '../contracts/summary';
import { type SealedPatientSnapshot, sealVersionedPatientSnapshot } from '../projection/builder';
import { FIXED_FIVE_SECTION_SYSTEM_PROMPT } from '../providers/prompt';
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
    content: Object.freeze({type: 'string'}),
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
  const prompt = `${FIXED_FIVE_SECTION_SYSTEM_PROMPT}\n\n` +
    '請只輸出 JSON；每節使用 sourceAliases（S1…），不得輸出 sourceRefs。\n' +
    JSON.stringify({coverage: rebuilt.snapshot.coverage, facts});
  return Object.freeze({
    scope: Object.freeze({...scope}), prompt, sourceAliases: Object.freeze(sourceAliases),
    [sealedSummaryRequestBrand]: true as const,
  });
}

export function isSealedSummaryRequest(value: unknown): value is SealedSummaryRequest {
  return typeof value === 'object' && value !== null &&
    Reflect.get(value, sealedSummaryRequestBrand) === true;
}

/** Fails closed unless a complete provider JSON document maps to local aliases. */
export function parseProviderSummaryOutput(
  output: unknown,
  request: SealedSummaryRequest,
): FixedFiveSectionSummary | null {
  if (typeof output !== 'string') return null;
  try {
    const parsed = providerSummarySchema.parse(JSON.parse(output));
    const sections = parsed.sections.map((section) => {
      const sourceRefs = section.sourceAliases.map((alias) => request.sourceAliases[alias]);
      if (sourceRefs.some((sourceRef) => sourceRef === undefined)) throw new TypeError('unknown source alias');
      return {heading: section.heading, content: section.content, sourceRefs};
    });
    const summary = fixedFiveSectionSummarySchema.safeParse({...parsed, sections});
    return summary.success ? summary.data : null;
  } catch {
    return null;
  }
}
