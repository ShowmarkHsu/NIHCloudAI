import type { ClinicalFact, PatientSnapshot, SafetySignal } from "../domain";
import { evaluateClinicalRules } from "../rules";
import {
  GET_CLINICAL_RULE_RESULTS,
  type ClinicalRuleMessageResponse,
  type ClinicalRuleResultView,
} from "../shared/clinicalRuleMessages";
import type { PatientSnapshotStore } from "./patientSnapshotStore";
import {
  isTrustedExtensionPage,
  type TrustedSender,
} from "./trustedSender";

type RuleEvaluator = (
  snapshot: PatientSnapshot,
) => Readonly<{
  facts: readonly ClinicalFact[];
  safetySignals: readonly SafetySignal[];
}>;

function toView(
  snapshot: PatientSnapshot,
  evaluation: ReturnType<RuleEvaluator>,
  evaluatedAt: string,
): ClinicalRuleResultView {
  const facts = evaluation.facts.map(
    ({ id, type, text, sourceRefs, derived }) => ({
      id,
      type,
      text,
      sourceRefs,
      derived: derived ?? false,
    }),
  );
  const safetySignals = evaluation.safetySignals.map(
    ({ id, kind, text, sourceRefs, severity }) => ({
      id,
      kind,
      text,
      sourceRefs,
      severity,
    }),
  );
  const cited = new Set([
    ...facts.flatMap((fact) => fact.sourceRefs),
    ...safetySignals.flatMap((signal) => signal.sourceRefs),
  ]);
  return {
    evaluatedAt,
    facts,
    safetySignals,
    sources: snapshot.records
      .filter((record) => cited.has(record.id))
      .map(({ id, type, recordedAt, summary }) => ({
        id,
        type,
        recordedAt,
        summary,
      })),
  };
}

export function createClinicalRuleMessageHandler(
  snapshots: Pick<PatientSnapshotStore, "active">,
  options: Readonly<{
    evaluate?: RuleEvaluator;
    now?: () => Date;
    trustedSender?: TrustedSender;
  }> = {},
) {
  const evaluate = options.evaluate ?? evaluateClinicalRules;
  const now = options.now ?? (() => new Date());
  const trustedSender = options.trustedSender ?? isTrustedExtensionPage;

  return async (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<ClinicalRuleMessageResponse | undefined> => {
    if (
      typeof message !== "object" ||
      message === null ||
      (message as Record<string, unknown>).type !== GET_CLINICAL_RULE_RESULTS
    ) {
      return undefined;
    }
    if (!trustedSender(sender)) {
      return { ok: false, error: "這個頁面不能讀取臨床規則結果。" };
    }

    try {
      const active = await snapshots.active();
      if (!active) return { ok: true, state: { kind: "unavailable" } };
      const result = toView(
        active.snapshot,
        evaluate(active.snapshot),
        now().toISOString(),
      );
      return { ok: true, state: { kind: "ready", result } };
    } catch {
      return { ok: false, error: "無法計算臨床規則結果。" };
    }
  };
}
