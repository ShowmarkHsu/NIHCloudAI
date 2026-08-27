import {
  OUT_OF_SCOPE_COVERAGE_FAMILIES,
  PHASE_ONE_SOURCE_FAMILIES,
  type SnapshotCoverage,
} from '../contracts/coverage';
import {
  FIXED_FIVE_SECTION_CHINESE_CHARACTER_LIMITS,
  FIXED_FIVE_SECTION_HEADINGS,
} from '../contracts/summary';
const COVERAGE_CONTEXT_SENTENCES = Object.freeze([
  '各項狀態僅代表本次資料涵蓋情形，仍須由人工逐項核對。',
  '未收集、未授權或取得失敗的資料不得推定其臨床狀態。',
  '超出本階段範圍的類別未納入本次摘要，後續仍待確認。',
  '已確認空值與資料缺口採不同固定文字呈現，避免誤判。',
  '摘要內容僅整理本次已收集且由來源明示的臨床事實，不得補充或推定未提供的結論。',
  '各節仍須回到可核對來源逐項確認，不能取代原始紀錄與專業判讀。',
]);

const COVERAGE_LABELS = Object.freeze({
  encounter: '就醫',
  'western-medication': '西藥',
  'chinese-medication': '中藥',
  allergy: '過敏',
  lab: '檢驗',
  imaging: '影像',
  procedure: '處置',
  discharge: '出院',
  'adult-health-check': '成人健檢',
  'cancer-screening': '癌症篩檢',
  'hepatitis-bc': 'B/C 型肝炎',
  'ckm-derived': 'CKM 衍生資料',
} as const);

const MEDICATION_AND_ALLERGY_FAMILIES = [
  'western-medication', 'chinese-medication', 'allergy',
] as const;
const ADMISSION_PROCEDURE_DISCHARGE_FAMILIES = [
  'encounter', 'procedure', 'discharge',
] as const;
const RECENT_COURSE_AND_TEST_FAMILIES = [
  'encounter', 'lab', 'imaging',
] as const;
const ALL_COVERAGE_FAMILIES = [
  ...PHASE_ONE_SOURCE_FAMILIES,
  ...OUT_OF_SCOPE_COVERAGE_FAMILIES,
] as const;

type CoverageFamily = (typeof ALL_COVERAGE_FAMILIES)[number];

export type CoverageRenderableSection = Readonly<{
  heading: (typeof FIXED_FIVE_SECTION_HEADINGS)[number];
  content: string;
  sourceAliases: readonly string[];
}>;

function fixedPhrase(family: CoverageFamily, coverage: SnapshotCoverage): string | null {
  const state = coverage[family];
  if (state.status === 'has-data') return null;
  return state.status === 'confirmed-empty'
    ? `${COVERAGE_LABELS[family]}：無可用資料`
    : `${COVERAGE_LABELS[family]}：資料缺口，待確認`;
}

function allWithoutData(
  families: readonly CoverageFamily[],
  coverage: SnapshotCoverage,
): boolean {
  return families.every((family) => coverage[family].status !== 'has-data');
}

export function sectionHasCollectedFacts(
  heading: CoverageRenderableSection['heading'],
  coverage: SnapshotCoverage,
): boolean {
  if (heading === FIXED_FIVE_SECTION_HEADINGS[0]) {
    return !allWithoutData(PHASE_ONE_SOURCE_FAMILIES, coverage);
  }
  if (heading === FIXED_FIVE_SECTION_HEADINGS[1]) {
    return !allWithoutData(MEDICATION_AND_ALLERGY_FAMILIES, coverage);
  }
  if (heading === FIXED_FIVE_SECTION_HEADINGS[2]) {
    return !allWithoutData(RECENT_COURSE_AND_TEST_FAMILIES, coverage);
  }
  if (heading === FIXED_FIVE_SECTION_HEADINGS[3]) {
    return !allWithoutData(ADMISSION_PROCEDURE_DISCHARGE_FAMILIES, coverage);
  }
  return false;
}

function renderSeparatePhrases(
  families: readonly CoverageFamily[],
  coverage: SnapshotCoverage,
): string {
  return `${families.map((family) => fixedPhrase(family, coverage)).filter((value): value is string => value !== null).join('；')}。`;
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length < 2) return labels[0] ?? '';
  const last = labels.at(-1) ?? '';
  const conjunction = /^[A-Za-z]/u.test(last) ? '及 ' : '及';
  return `${labels.slice(0, -1).join('、')}${conjunction}${last}`;
}

function renderDataGapSection(coverage: SnapshotCoverage): string {
  const confirmedEmpty: string[] = [];
  const dataGaps: string[] = [];
  for (const family of ALL_COVERAGE_FAMILIES) {
    const state = coverage[family];
    if (state.status === 'confirmed-empty') confirmedEmpty.push(COVERAGE_LABELS[family]);
    else if (state.status !== 'has-data') dataGaps.push(COVERAGE_LABELS[family]);
  }
  const phrases = [
    confirmedEmpty.length > 0 ? `${joinLabels(confirmedEmpty)}：無可用資料` : null,
    dataGaps.length > 0 ? `${joinLabels(dataGaps)}：資料缺口，待確認` : null,
  ].filter((value): value is string => value !== null);
  return `${phrases.join('；')}。`;
}

function deterministicSection(
  section: CoverageRenderableSection,
  content: string,
): CoverageRenderableSection {
  return Object.freeze({heading: section.heading, content, sourceAliases: Object.freeze([])});
}

function countChineseCharacters(content: string): number {
  return [...content].filter((character) => /\p{Script=Han}/u.test(character)).length;
}

function meetMinimumSummaryLength(
  sections: readonly CoverageRenderableSection[],
): readonly CoverageRenderableSection[] {
  let characterCount = sections.reduce(
    (total, section) => total + countChineseCharacters(section.content),
    0,
  );
  if (characterCount >= FIXED_FIVE_SECTION_CHINESE_CHARACTER_LIMITS.minimum) return sections;
  const dataGapIndex = sections.findIndex(
    (section) => section.heading === FIXED_FIVE_SECTION_HEADINGS[4],
  );
  if (dataGapIndex < 0) return sections;
  let dataGapContent = sections[dataGapIndex]?.content ?? '';
  for (const sentence of COVERAGE_CONTEXT_SENTENCES) {
    if (characterCount >= FIXED_FIVE_SECTION_CHINESE_CHARACTER_LIMITS.minimum) break;
    dataGapContent += sentence;
    characterCount += countChineseCharacters(sentence);
  }
  return Object.freeze(sections.map((section, index) =>
    index === dataGapIndex ? deterministicSection(section, dataGapContent) : section));
}

/**
 * Provider prose is retained only where the section has collected facts to
 * summarize. Fully uncovered sections and the coverage gap section are
 * rendered locally from the sealed coverage contract.
 */
export function renderDeterministicCoverageSections(
  sections: readonly CoverageRenderableSection[],
  coverage: SnapshotCoverage,
): readonly CoverageRenderableSection[] {
  const rendered = Object.freeze(sections.map((section) => {
    if (
      section.heading === FIXED_FIVE_SECTION_HEADINGS[0] &&
      !sectionHasCollectedFacts(section.heading, coverage)
    ) {
      return deterministicSection(
        section,
        '目前僅有資料涵蓋狀態，未提供可供核對的已收集臨床事實；所有類別均須依固定資料缺口規則由人工確認，不得據此推定任何未提供的臨床結論。',
      );
    }
    if (
      section.heading === FIXED_FIVE_SECTION_HEADINGS[1] &&
      !sectionHasCollectedFacts(section.heading, coverage)
    ) {
      return deterministicSection(
        section,
        renderSeparatePhrases(MEDICATION_AND_ALLERGY_FAMILIES, coverage),
      );
    }
    if (
      section.heading === FIXED_FIVE_SECTION_HEADINGS[2] &&
      !sectionHasCollectedFacts(section.heading, coverage)
    ) {
      return deterministicSection(
        section,
        renderSeparatePhrases(RECENT_COURSE_AND_TEST_FAMILIES, coverage),
      );
    }
    if (
      section.heading === FIXED_FIVE_SECTION_HEADINGS[3] &&
      !sectionHasCollectedFacts(section.heading, coverage)
    ) {
      return deterministicSection(
        section,
        renderSeparatePhrases(ADMISSION_PROCEDURE_DISCHARGE_FAMILIES, coverage),
      );
    }
    if (section.heading === FIXED_FIVE_SECTION_HEADINGS[4]) {
      return deterministicSection(section, renderDataGapSection(coverage));
    }
    return section;
  }));
  return meetMinimumSummaryLength(rendered);
}
