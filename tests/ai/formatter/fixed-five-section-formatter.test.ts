import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  FIXED_FIVE_SECTION_SCHEMA_VERSION,
  FIXED_FIVE_SECTION_TIME_WINDOWS,
} from '../../../src/ai/contracts/summary';
import { formatFixedFiveSectionSummary } from '../../../src/ai/summary/formatter';

const summary = {
  schemaVersion: FIXED_FIVE_SECTION_SCHEMA_VERSION,
  timeWindows: FIXED_FIVE_SECTION_TIME_WINDOWS,
  sections: [
    {
      heading: '核對重點',
      content: '過敏史與異常檢驗需優先核對；血糖數值變化及來源紀錄應逐項確認；結果須回到原始資料逐項比對。',
      sourceRefs: ['sr_formatter_00000001'],
    },
    {
      heading: '目前用藥與過敏',
      content: '目前用藥為合成藥物甲，每次一錠、每日兩次；過敏紀錄須與病人再次核實，並確認劑量與頻次是否仍適用。',
      sourceRefs: ['sr_formatter_00000002'],
    },
    {
      heading: '近期病程與檢查',
      content: '近九十日就醫紀錄含門診追蹤；檢驗值與影像報告只陳述來源已載明的內容，並比對日期與單位；不延伸解讀病因或病情。',
      sourceRefs: ['sr_formatter_00000003'],
    },
    {
      heading: '住院、手術與出院',
      content: '近一年住院、手術與出院紀錄依來源順序整理；日期或診斷內容不足時，保留給人工核對；不以缺漏內容推定陰性結果。',
      sourceRefs: ['sr_formatter_00000004'],
    },
    {
      heading: '資料缺口與待確認',
      content: '資料缺口：部分來源尚待完整取得或正規化。待確認：院內病歷與病人所述的時間範圍及相關事實。',
      sourceRefs: [],
    },
  ],
};

const golden = readFileSync(
  new URL('../../fixtures/clinical/expected/fixed-five-section-summary.txt', import.meta.url),
  'utf8',
);

describe('fixed five-section plain-text formatter', () => {
  it('emits deterministic UTF-8 bytes, LF line endings, and only fixed headings', () => {
    const first = formatFixedFiveSectionSummary(summary);
    const second = formatFixedFiveSectionSummary(summary);

    expect(first).toBe(second);
    expect(Buffer.from(first, 'utf8')).toEqual(Buffer.from(golden, 'utf8'));
    expect(first.match(/^【.+】$/gmu)).toHaveLength(5);
    expect(first).not.toContain('\r');
    expect(first).not.toMatch(/sr_formatter|sourceRef|provider|prompt|schema|model/iu);
  });

  it('fails closed and never strips an invalid field to produce copy text', () => {
    const invalid = structuredClone(summary);
    invalid.sections[0]!.content = '來源代碼 sr_formatter_00000001 必須拒絕。';

    expect(() => formatFixedFiveSectionSummary(invalid)).toThrow();
  });
});
