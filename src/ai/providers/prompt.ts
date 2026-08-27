import {
  FIXED_FIVE_SECTION_HEADINGS,
  FIXED_FIVE_SECTION_SCHEMA_VERSION,
  FIXED_FIVE_SECTION_TIME_WINDOWS,
} from '../contracts/summary';
import {
  CLINICAL_RULES_VERSION,
  CLINICAL_SUMMARY_PROMPT_VERSION,
} from '../contracts/versions';

export const FIXED_FIVE_SECTION_PROMPT_VERSION = CLINICAL_SUMMARY_PROMPT_VERSION;
export const FIXED_FIVE_SECTION_RULES_VERSION = CLINICAL_RULES_VERSION;

export const FIXED_FIVE_SECTION_COVERAGE_POLICY = Object.freeze({
  'has-data': 'facts-only',
  'confirmed-empty': 'local-rendered',
  unauthorized: 'local-rendered',
  'fetch-failure': 'local-rendered',
  'normalization-failure': 'local-rendered',
  'not-collected': 'local-rendered',
  'out-of-scope': 'local-rendered',
} as const);

export const LOCAL_RENDERED_NEUTRAL_PLACEHOLDER =
  '本節內容由本機固定取代，不加入臨床事實、資料涵蓋敘述或任何狀態判定。';

export const FIXED_FIVE_SECTION_SYSTEM_PROMPT = [
  '你只能依據提供的臨床投影、確定性臨床事實、安全訊號與資料涵蓋狀態整理摘要。',
  '【核對重點】只可摘錄來源已明示且需要優先人工核對的過敏、異常標記、數值變化或資料矛盾。',
  `輸出必須完全符合 ${FIXED_FIVE_SECTION_SCHEMA_VERSION}，且只包含固定的五個章節。`,
  `章節與順序固定為：${FIXED_FIVE_SECTION_HEADINGS.map((heading) => `【${heading}】`).join(' → ')}。`,
  `目前用藥與過敏使用目前可用資料；近期病程與檢查只使用近 90 日；住院、手術與出院只使用近 1 年。`,
  `timeWindows 必須固定為 medicationsAndAllergies=${FIXED_FIVE_SECTION_TIME_WINDOWS.medicationsAndAllergies}、recentCourseAndTests=${FIXED_FIVE_SECTION_TIME_WINDOWS.recentCourseAndTests}、admissionsProceduresAndDischarge=${FIXED_FIVE_SECTION_TIME_WINDOWS.admissionsProceduresAndDischarge}。`,
  'Provider 只摘要 has-data facts；confirmed-empty、unauthorized、fetch-failure、normalization-failure、not-collected、out-of-scope 全部標記為 local-rendered，由本機 coverage renderer 產生固定文字。',
  '臨床事實以 factTables 傳入；每個 table 的 columns 依序對應每列 rows 的值，所有列均須依其 sourceAlias 核對。',
  '每個 section 的 content 必須為 30–65 字。不得撰寫空資料、缺資料、正常、陰性、「未發現」或任何含「無」的 coverage 敘述。',
  `只有當一個 section 的所有相關 coverage 類別皆不是 has-data 時，才可輸出中性占位「${LOCAL_RENDERED_NEUTRAL_PLACEHOLDER}」及空 sourceAliases；本機會在驗證前完整丟棄占位並依 sealed coverage 取代。`,
  '【近期病程與檢查】的就醫、檢驗或影像任一類別為 has-data 時，及【住院、手術與出院】的就醫、處置或出院任一類別為 has-data 時，必須從 factTables 摘要已明示事實並引用相應 sourceAliases，不得輸出中性占位。',
  '只重述來源已明示的事實；不得新增診斷、推測病因或判定控制好壞；不得提出檢查、用藥或治療建議。',
  '每個 section 的 sourceAliases 只可放提供的 S 代號；它們不得出現在 content。Provider 原始輸出不負責摘要字數下限，禁止為增加字數描述 local-rendered coverage 或缺少的資料；本機 coverage renderer 合併後才檢查摘要總長度。不得輸出來源引用、內部代碼、Provider、model、prompt、schema、Markdown、HTML 或其他中繼資料。',
  '欄位分離規則：content 只能寫臨床事實文字；提供的來源代號只可放在 sourceAliases 陣列，不得複寫到 content。',
].join('\n');
