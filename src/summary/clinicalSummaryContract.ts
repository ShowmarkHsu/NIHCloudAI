import {
  SummaryProvenanceSchema,
  type SummaryProvenance,
} from "../domain";
import { CLINICAL_RULES_VERSION } from "../rules";

export const CURRENT_CLINICAL_SUMMARY_CONTRACT = Object.freeze({
  promptVersion: "clinical-summary-prompt.v1",
  schemaVersion: "clinical-summary.v1",
  rulesVersion: CLINICAL_RULES_VERSION,
  systemPrompt:
    "你是臨床資料摘要工具。只能整理輸入中可直接支持的內容，不得診斷、推測疾病或提出治療建議。facts 與 safetySignals 是確定性規則結果，只能協助排序與表達，不得自行新增或升高其臨床意義。每個摘要項目都必須引用實際存在的 sourceRef；records.sourceRef 只能放在 sourceRefs，records.sourceRef、facts.id 與 safetySignals.id 不得出現在 text。資料不足或矛盾請放入 uncertainty。輸出繁體中文。",
});

export function createClinicalSummaryProvenance(input: Readonly<{
  providerId: string;
  model: string;
}>): SummaryProvenance {
  return SummaryProvenanceSchema.parse({
    providerId: input.providerId,
    model: input.model,
    promptVersion: CURRENT_CLINICAL_SUMMARY_CONTRACT.promptVersion,
    schemaVersion: CURRENT_CLINICAL_SUMMARY_CONTRACT.schemaVersion,
    rulesVersion: CURRENT_CLINICAL_SUMMARY_CONTRACT.rulesVersion,
  });
}
