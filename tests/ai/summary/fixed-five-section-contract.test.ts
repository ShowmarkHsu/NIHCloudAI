import { describe, expect, it } from 'vitest';

import {
  FIXED_FIVE_SECTION_HEADINGS,
  FIXED_FIVE_SECTION_SCHEMA_VERSION,
  FIXED_FIVE_SECTION_TIME_WINDOWS,
  fixedFiveSectionSummarySchema,
  parseFixedFiveSectionSummary,
} from '../../../src/ai/contracts/summary';
import {
  FIXED_FIVE_SECTION_RULES_VERSION,
  FIXED_FIVE_SECTION_SYSTEM_PROMPT,
} from '../../../src/ai/providers/prompt';
import {
  isDateWithinSummaryTimeWindow,
  summaryTimeWindowForSourceFamily,
} from '../../../src/ai/rules/summaryTimeWindows';

const validSummary = {
  schemaVersion: FIXED_FIVE_SECTION_SCHEMA_VERSION,
  timeWindows: FIXED_FIVE_SECTION_TIME_WINDOWS,
  sections: [
    { heading: '核對重點', content: '重'.repeat(40), sourceRefs: ['sr_summary_000000001'] },
    { heading: '目前用藥與過敏', content: '要'.repeat(40), sourceRefs: ['sr_summary_000000002'] },
    { heading: '近期病程與檢查', content: '點'.repeat(40), sourceRefs: ['sr_summary_000000003'] },
    { heading: '住院、手術與出院', content: '資'.repeat(40), sourceRefs: ['sr_summary_000000004'] },
    {
      heading: '資料缺口與待確認',
      content: `資料缺口：${'待'.repeat(40)}；待確認：${'核'.repeat(40)}`,
      sourceRefs: [],
    },
  ],
};

describe('fixed five-section summary contract', () => {
  it('accepts the only complete section order and fixed time windows', () => {
    const parsed = parseFixedFiveSectionSummary(validSummary);

    expect(parsed.schemaVersion).toBe(FIXED_FIVE_SECTION_SCHEMA_VERSION);
    expect(parsed.timeWindows).toEqual(FIXED_FIVE_SECTION_TIME_WINDOWS);
    expect(parsed.sections.map((section) => section.heading)).toEqual(
      FIXED_FIVE_SECTION_HEADINGS,
    );
  });

  it('fails closed for missing, reordered, extra, or partial sections', () => {
    const missing = structuredClone(validSummary);
    missing.sections.pop();

    const reordered = structuredClone(validSummary);
    [reordered.sections[0], reordered.sections[1]] = [
      reordered.sections[1]!,
      reordered.sections[0]!,
    ];

    const extra = structuredClone(validSummary);
    extra.sections.push({ heading: '額外章節', content: '重'.repeat(40), sourceRefs: [] });

    for (const output of [missing, reordered, extra, { sections: [] }]) {
      expect(fixedFiveSectionSummarySchema.safeParse(output).success).toBe(false);
    }
  });

  it('fails closed for changed time windows and insufficient Chinese content', () => {
    const changedWindow = structuredClone(validSummary);
    Reflect.set(changedWindow.timeWindows, 'recentCourseAndTests', 'past-30-days');

    const tooShort = structuredClone(validSummary);
    for (const section of tooShort.sections.slice(0, 4)) {
      section.content = '太短';
    }
    tooShort.sections[4]!.content = '資料缺口，待確認。';

    expect(fixedFiveSectionSummarySchema.safeParse(changedWindow).success).toBe(false);
    expect(fixedFiveSectionSummarySchema.safeParse(tooShort).success).toBe(false);
  });

  it('requires the fixed data-gap and confirmation wording', () => {
    const missingGapWording = structuredClone(validSummary);
    missingGapWording.sections[4]!.content = '資料仍需人工核對。';

    expect(
      fixedFiveSectionSummarySchema.safeParse(missingGapWording).success,
    ).toBe(false);
  });

  it('rejects metadata, internal references, and Markdown instead of stripping them', () => {
    for (const forbiddenContent of [
      '來源代碼 sr_internal_00000001 必須移除。',
      '內部識別 pt_opaque_patient_0001 必須移除。',
      '內部識別 ds_opaque_session_0001 必須移除。',
      'S1 必須移除。',
      'S9999 必須移除。',
      'provider: synthetic-provider',
      '<strong>不是純文字</strong>',
      '```json\n{}\n```',
    ]) {
      const output = structuredClone(validSummary);
      output.sections[0]!.content = `${forbiddenContent}${'重'.repeat(40)}`;

      expect(fixedFiveSectionSummarySchema.safeParse(output).success).toBe(false);
    }
  });

  it('rejects missing-as-negative wording except the fixed 無可用資料 phrase', () => {
    for (const forbiddenContent of ['近期影像未發現資料。', '檢驗正常。', '資料無。']) {
      const output = structuredClone(validSummary);
      output.sections[0]!.content = `${forbiddenContent}${'重'.repeat(40)}`;

      expect(fixedFiveSectionSummarySchema.safeParse(output).success).toBe(false);
    }
  });
});

describe('fixed summary time-window rules', () => {
  const capturedAt = '2026-08-20T12:00:00.000Z';

  it('maps each Phase 1 family to its approved window', () => {
    expect(summaryTimeWindowForSourceFamily('allergy')).toBe('current-available-data');
    expect(summaryTimeWindowForSourceFamily('lab')).toBe('past-90-days');
    expect(summaryTimeWindowForSourceFamily('discharge')).toBe('past-1-year');
  });

  it('uses fixed Asia/Taipei boundaries and never cuts off current medication or allergy', () => {
    expect(isDateWithinSummaryTimeWindow('2026-05-22', capturedAt, 'past-90-days')).toBe(true);
    expect(isDateWithinSummaryTimeWindow('2026-05-21', capturedAt, 'past-90-days')).toBe(false);
    expect(isDateWithinSummaryTimeWindow('2025-08-20', capturedAt, 'past-1-year')).toBe(true);
    expect(isDateWithinSummaryTimeWindow('2025-08-19', capturedAt, 'past-1-year')).toBe(false);
    expect(isDateWithinSummaryTimeWindow('2020-01-01', capturedAt, 'current-available-data')).toBe(true);
  });
});

describe('fixed five-section rules prompt', () => {
  it('pins the section order, windows, and missing-not-negative language', () => {
    expect(FIXED_FIVE_SECTION_RULES_VERSION).toBe('clinical-rules.v2');

    for (const heading of FIXED_FIVE_SECTION_HEADINGS) {
      expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain(`【${heading}】`);
    }

    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('目前可用資料');
    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('近 90 日');
    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('近 1 年');
    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('只摘要 has-data facts');
    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('local-rendered');
    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('由本機完整取代');
    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('不得新增診斷');
    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('不得提出檢查、用藥或治療建議');
    expect(FIXED_FIVE_SECTION_SYSTEM_PROMPT).toContain('過敏、異常標記、數值變化或資料矛盾');
  });
});
