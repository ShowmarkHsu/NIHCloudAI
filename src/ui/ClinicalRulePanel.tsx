import { useEffect, useMemo, useState } from "react";
import type { ClinicalRuleResultView } from "../shared/clinicalRuleMessages";
import {
  chromeClinicalRuleMessaging,
  type ClinicalRuleMessaging,
} from "./clinicalRuleMessaging";

type RulePanelState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "ready"; result: ClinicalRuleResultView }>
  | Readonly<{ kind: "error" }>;

const signalLabels: Record<string, string> = {
  "abnormal-lab": "明示異常檢驗",
  "lab-trend": "檢驗數值趨勢",
  "medication-overlap": "用藥區間重疊",
  "duplicate-test": "重複檢查",
  "allergy-risk": "過敏來源核對",
  "missing-data": "資料缺漏",
  contradiction: "資料矛盾",
  other: "其他",
};

export function ClinicalRulePanel({
  messaging = chromeClinicalRuleMessaging,
}: Readonly<{ messaging?: ClinicalRuleMessaging }>) {
  const [state, setState] = useState<RulePanelState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void messaging
      .getResults()
      .then((response) => {
        if (cancelled) return;
        if (!response?.ok) setState({ kind: "error" });
        else if (response.state.kind === "ready") {
          setState({ kind: "ready", result: response.state.result });
        } else setState({ kind: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [messaging]);

  const sourceById = useMemo(
    () => new Map(
      state.kind === "ready"
        ? state.result.sources.map((source) => [source.id, source] as const)
        : [],
    ),
    [state],
  );

  return (
    <section className="rule-panel" aria-labelledby="rule-panel-title">
      <div className="section-heading rule-panel__heading">
        <div>
          <p className="section-heading__eyebrow">Deterministic rules</p>
          <h2 id="rule-panel-title">規則整理與安全訊號</h2>
        </div>
        <span className="session-pill">非 AI 判斷</span>
      </div>

      {state.kind === "loading" ? <p className="rule-panel__empty">計算規則中…</p> : null}
      {state.kind === "unavailable" ? (
        <p className="rule-panel__empty">請先在健保雲端開啟已授權的病人資料。</p>
      ) : null}
      {state.kind === "error" ? (
        <p className="rule-panel__error" role="alert">無法取得規則結果，請重新開啟擴充功能。</p>
      ) : null}

      {state.kind === "ready" ? (
        <>
          {state.result.safetySignals.length === 0 ? (
            <p className="rule-panel__empty">目前資料未觸發可重現的規則安全訊號。</p>
          ) : (
            <ul className="rule-signal-list">
              {state.result.safetySignals.map((signal) => (
                <li key={signal.id} className={`rule-signal rule-signal--${signal.severity}`}>
                  <div className="rule-signal__heading">
                    <strong>{signalLabels[signal.kind] ?? signal.kind}</strong>
                    <span>{signal.severity === "urgent-review" ? "優先核對" : "請留意"}</span>
                  </div>
                  <p>{signal.text}</p>
                  <div className="summary-sources">
                    {signal.sourceRefs.map((sourceRef) => {
                      const source = sourceById.get(sourceRef);
                      return (
                        <details key={sourceRef}>
                          <summary>查看規則來源 · {source?.type ?? "record"}</summary>
                          <p>{source?.summary ?? "來源紀錄目前無法顯示。"}</p>
                          {source ? <time dateTime={source.recordedAt}>{source.recordedAt}</time> : null}
                        </details>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <details className="rule-facts">
            <summary>查看規則整理的臨床事實（{state.result.facts.length}）</summary>
            <ul>
              {state.result.facts.map((fact) => (
                <li key={fact.id}>
                  <p>{fact.text}</p>
                  <div className="summary-sources">
                    {fact.sourceRefs.map((sourceRef) => {
                      const source = sourceById.get(sourceRef);
                      return (
                        <details key={sourceRef}>
                          <summary>查看事實來源 · {source?.type ?? "record"}</summary>
                          <p>{source?.summary ?? "來源紀錄目前無法顯示。"}</p>
                          {source ? <time dateTime={source.recordedAt}>{source.recordedAt}</time> : null}
                        </details>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </details>
          <p className="rule-panel__meta">規則計算時間 {state.result.evaluatedAt}</p>
        </>
      ) : null}
    </section>
  );
}
