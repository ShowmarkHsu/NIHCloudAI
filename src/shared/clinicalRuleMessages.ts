import type {
  ClinicalFactType,
  SafetySignalKind,
  SafetySignalSeverity,
} from "../domain";
import type { SummarySourcePreview } from "./clinicalSummaryMessages";

export const GET_CLINICAL_RULE_RESULTS = "GET_CLINICAL_RULE_RESULTS" as const;

export type GetClinicalRuleResultsMessage = Readonly<{
  type: typeof GET_CLINICAL_RULE_RESULTS;
}>;

export type ClinicalFactView = Readonly<{
  id: string;
  type: ClinicalFactType;
  text: string;
  sourceRefs: readonly string[];
  derived: boolean;
}>;

export type SafetySignalView = Readonly<{
  id: string;
  kind: SafetySignalKind;
  text: string;
  sourceRefs: readonly string[];
  severity: SafetySignalSeverity;
}>;

export type ClinicalRuleResultView = Readonly<{
  evaluatedAt: string;
  facts: readonly ClinicalFactView[];
  safetySignals: readonly SafetySignalView[];
  sources: readonly SummarySourcePreview[];
}>;

export type ClinicalRuleResultState =
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "ready"; result: ClinicalRuleResultView }>;

export type ClinicalRuleMessageResponse =
  | Readonly<{ ok: true; state: ClinicalRuleResultState }>
  | Readonly<{ ok: false; error: string }>;
