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
          'summary content must not contain internal references, provenance, or Markdown',
        )
        .refine(
          (content) => !usesMissingAsNegativeFinding(content),
          'summary content must not express missing data as a negative finding',
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
      'data-gap section must use the fixed data-gap and confirmation wording',
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

export type FixedFiveSectionSummary = z.infer<
  typeof fixedFiveSectionSummarySchema
>;
