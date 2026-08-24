import { z } from 'zod';

import { sourceReferenceSchema } from './clinicalProjection';
import { CLINICAL_SUMMARY_SCHEMA_VERSION } from './versions';

export const FIXED_FIVE_SECTION_SCHEMA_VERSION = CLINICAL_SUMMARY_SCHEMA_VERSION;

export const FIXED_FIVE_SECTION_HEADINGS = [
  '核對重點',
  '目前用藥與過敏',
  '近期病程與檢查',
  '住院、手術與出院',
  '資料缺口與待確認',
] as const;

export const FIXED_FIVE_SECTION_TIME_WINDOWS = Object.freeze({
  medicationsAndAllergies: 'current-available-data',
  recentCourseAndTests: 'past-90-days',
  admissionsProceduresAndDischarge: 'past-1-year',
} as const);

export const FIXED_FIVE_SECTION_CHINESE_CHARACTER_LIMITS = Object.freeze({
  minimum: 180,
  maximum: 260,
} as const);

export const FIXED_FIVE_SECTION_VALIDATION_MESSAGES = Object.freeze({
  forbiddenMetadata: 'summary content must not contain internal references, provenance, or Markdown',
  missingAsNegative: 'summary content must not express missing data as a negative finding',
  dataGapWording: 'data-gap section must use the fixed data-gap and confirmation wording',
} as const);

const FORBIDDEN_COPY_METADATA = /(?:\b(?:sr|pt|ds)_[A-Za-z0-9_-]+\b|source(?:Ref|Reference)|patientId|sessionId|\bprovider\b|\bprompt\b|\bschema\b|\bmodel\b|S[1-6]|<\/?[A-Za-z][^>]*>|```|(?:^|\n)\s*(?:#|[-*+]\s|\d+\.\s))/iu;

function countChineseCharacters(text: string): number {
  return [...text].filter((character) => /\p{Script=Han}/u.test(character))
    .length;
}

function usesMissingAsNegativeFinding(content: string): boolean {
  return (
    content.includes('未發現') ||
    content.includes('正常') ||
    content.replaceAll('無可用資料', '').includes('無')
  );
}

function summaryContentSchema(heading: (typeof FIXED_FIVE_SECTION_HEADINGS)[number]) {
  return z
    .object({
      heading: z.literal(heading),
      content: z
        .string()
        .trim()
        .min(1)
        .max(800)
        .refine(
          (content) => !FORBIDDEN_COPY_METADATA.test(content),
          FIXED_FIVE_SECTION_VALIDATION_MESSAGES.forbiddenMetadata,
        )
        .refine(
          (content) => !usesMissingAsNegativeFinding(content),
          FIXED_FIVE_SECTION_VALIDATION_MESSAGES.missingAsNegative,
        ),
      sourceRefs: z.array(sourceReferenceSchema).max(100).readonly(),
    })
    .strict()
    .readonly();
}

const fixedFiveSectionTimeWindowsSchema = z
  .object({
    medicationsAndAllergies: z.literal(
      FIXED_FIVE_SECTION_TIME_WINDOWS.medicationsAndAllergies,
    ),
    recentCourseAndTests: z.literal(
      FIXED_FIVE_SECTION_TIME_WINDOWS.recentCourseAndTests,
    ),
    admissionsProceduresAndDischarge: z.literal(
      FIXED_FIVE_SECTION_TIME_WINDOWS.admissionsProceduresAndDischarge,
    ),
  })
  .strict()
  .readonly();

const fixedFiveSectionSchema = z
  .tuple([
    summaryContentSchema(FIXED_FIVE_SECTION_HEADINGS[0]),
    summaryContentSchema(FIXED_FIVE_SECTION_HEADINGS[1]),
    summaryContentSchema(FIXED_FIVE_SECTION_HEADINGS[2]),
    summaryContentSchema(FIXED_FIVE_SECTION_HEADINGS[3]),
    summaryContentSchema(FIXED_FIVE_SECTION_HEADINGS[4]).refine(
      (section) =>
        section.content.includes('資料缺口') && section.content.includes('待確認'),
      FIXED_FIVE_SECTION_VALIDATION_MESSAGES.dataGapWording,
    ),
  ])
  .readonly();

const fixedFiveSectionSummaryObjectSchema = z
  .object({
    schemaVersion: z.literal(FIXED_FIVE_SECTION_SCHEMA_VERSION),
    timeWindows: fixedFiveSectionTimeWindowsSchema,
    sections: fixedFiveSectionSchema,
  })
  .strict();

export const fixedFiveSectionSummarySchema = fixedFiveSectionSummaryObjectSchema
  .superRefine((summary, context) => {
    const characterCount = summary.sections.reduce(
      (total, section) => total + countChineseCharacters(section.content),
      0,
    );

    if (
      characterCount < FIXED_FIVE_SECTION_CHINESE_CHARACTER_LIMITS.minimum ||
      characterCount > FIXED_FIVE_SECTION_CHINESE_CHARACTER_LIMITS.maximum
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `summary must contain ${FIXED_FIVE_SECTION_CHINESE_CHARACTER_LIMITS.minimum}-${FIXED_FIVE_SECTION_CHINESE_CHARACTER_LIMITS.maximum} Chinese characters`,
        path: ['sections'],
      });
    }
  })
  .readonly();

export function parseFixedFiveSectionSummary(value: unknown): FixedFiveSectionSummary {
  return fixedFiveSectionSummarySchema.parse(value);
}

export type FixedFiveSectionContentFailure =
  | 'metadata'
  | 'negative-finding'
  | 'data-gap-wording'
  | 'field-bounds'
  | 'other';

/** Maps validation issues to a bounded reason without returning issue details. */
export function classifyFixedFiveSectionContentFailure(
  issues: readonly Readonly<{code: string; message: string; path: readonly PropertyKey[]}>[],
): FixedFiveSectionContentFailure {
  if (issues.some((issue) => issue.message === FIXED_FIVE_SECTION_VALIDATION_MESSAGES.missingAsNegative)) {
    return 'negative-finding';
  }
  if (issues.some((issue) => issue.message === FIXED_FIVE_SECTION_VALIDATION_MESSAGES.forbiddenMetadata)) {
    return 'metadata';
  }
  if (issues.some((issue) => issue.message === FIXED_FIVE_SECTION_VALIDATION_MESSAGES.dataGapWording)) {
    return 'data-gap-wording';
  }
  if (issues.some((issue) =>
    issue.path.at(-1) === 'content' && (issue.code === 'too_small' || issue.code === 'too_big'))) {
    return 'field-bounds';
  }
  return 'other';
}

export type FixedFiveSectionSummary = z.infer<
  typeof fixedFiveSectionSummarySchema
>;
