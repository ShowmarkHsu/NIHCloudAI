import { useEffect, useMemo, useRef, useState } from "react";
import {
  CANCEL_CLINICAL_SUMMARY,
  GENERATE_CLINICAL_SUMMARY,
  GET_CLINICAL_SUMMARY,
  type ClinicalSummaryView,
} from "../shared/clinicalSummaryMessages";
import {
  OPENROUTER_PROVIDER_ID,
  type ProviderId,
} from "../shared/providerSecretMessages";
import {
  chromeClinicalSummaryMessaging,
  type ClinicalSummaryMessaging,
} from "./clinicalSummaryMessaging";

type ClinicalSummaryPanelProps = Readonly<{
  provider: ProviderId;
  model: string;
  messaging?: ClinicalSummaryMessaging;
}>;

type PanelState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "generating" }>
  | Readonly<{ kind: "ready"; summary: ClinicalSummaryView }>
  | Readonly<{ kind: "error"; message: string }>;

const sectionLabels: Record<string, string> = {
  timeline: "近期時序",
  medication: "用藥",
  allergy: "過敏",
  lab: "檢驗",
  imaging: "影像",
  hospitalization: "住院",
  discharge: "出院",
  uncertainty: "資料不足或矛盾",
};

const importanceLabels: Record<string, string> = {
  routine: "一般",
  attention: "請留意",
  "urgent-review": "優先核對",
};

export function ClinicalSummaryPanel({
  provider,
  model,
  messaging = chromeClinicalSummaryMessaging,
}: ClinicalSummaryPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [remoteConsent, setRemoteConsent] = useState(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void messaging
      .send({ type: GET_CLINICAL_SUMMARY })
      .then((response) => {
        if (cancelled) return;
        if (!response?.ok) {
          setState({ kind: "error", message: response?.error ?? "無法取得摘要狀態。" });
          return;
        }
        setState(
          response.state.kind === "ready"
            ? { kind: "ready", summary: response.state.summary }
            : { kind: "idle" },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "無法取得摘要狀態。" });
      });
    return () => {
      cancelled = true;
    };
  }, [messaging]);

  useEffect(() => {
    setRemoteConsent(false);
  }, [provider]);

  const sourceById = useMemo(
    () =>
      new Map(
        state.kind === "ready"
          ? state.summary.sources.map((source) => [source.id, source] as const)
          : [],
      ),
    [state],
  );

  const isRemote = provider === OPENROUTER_PROVIDER_ID;
  const canGenerate =
    state.kind !== "generating" &&
    model.trim().length > 0 &&
    (!isRemote || remoteConsent);

  async function generate() {
    if (!canGenerate) return;
    const version = ++requestVersion.current;
    setState({ kind: "generating" });

    try {
      if (isRemote && !(await messaging.requestRemotePermission())) {
        if (requestVersion.current === version) {
          setState({
            kind: "error",
            message: "未取得遠端 Provider 網域權限，沒有傳送病歷資料。",
          });
        }
        return;
      }
      const response = await messaging.send({
        type: GENERATE_CLINICAL_SUMMARY,
        providerId: provider,
        model: model.trim(),
        remoteDataConsent: isRemote ? remoteConsent : undefined,
      });
      if (requestVersion.current !== version) return;
      if (!response?.ok) {
        setState({
          kind: "error",
          message: response?.error ?? "無法產生摘要。",
        });
        return;
      }
      setState(
        response.state.kind === "ready"
          ? { kind: "ready", summary: response.state.summary }
          : { kind: "idle" },
      );
    } catch {
      if (requestVersion.current === version) {
        setState({ kind: "error", message: "無法產生摘要，請稍後再試。" });
      }
    }
  }

  async function cancel() {
    requestVersion.current += 1;
    setState({ kind: "idle" });
    try {
      await messaging.send({ type: CANCEL_CLINICAL_SUMMARY });
    } catch {
      // The local state is already safe; background timeout/stale checks remain active.
    }
  }

  return (
    <section className="summary-section" aria-labelledby="clinical-summary-title">
      <div className="section-heading summary-section__heading">
        <div>
          <p className="section-heading__eyebrow">AI summary</p>
          <h2 id="clinical-summary-title">病歷摘要</h2>
        </div>
        <span className="session-pill">每項附來源</span>
      </div>

      <div className="summary-action-bar">
        <div>
          <strong>{provider === "ollama" ? "本機 Ollama" : "OpenRouter BYOK"}</strong>
          <small>{model.trim() || "請先輸入模型名稱"}</small>
        </div>
        {state.kind === "generating" ? (
          <button className="button button--secondary" type="button" onClick={() => void cancel()}>
            取消
          </button>
        ) : (
          <button
            className="button button--primary"
            type="button"
            disabled={!canGenerate}
            onClick={() => void generate()}
          >
            {state.kind === "ready" ? "重新產生摘要" : "產生摘要"}
          </button>
        )}
      </div>

      {isRemote ? (
        <label className="remote-consent">
          <input
            type="checkbox"
            checked={remoteConsent}
            onChange={(event) => setRemoteConsent(event.target.checked)}
          />
          <span>
            我了解標準化病歷快照會傳送至 OpenRouter（openrouter.ai），並由
            openai/gpt-oss-120b 整理；API Key 仍只由 background 使用。
          </span>
        </label>
      ) : (
        <p className="summary-local-note">資料會送至本機 localhost Ollama，不會使用遠端 API Key。</p>
      )}

      {state.kind === "loading" ? <p className="summary-empty">讀取摘要狀態中…</p> : null}
      {state.kind === "idle" ? (
        <p className="summary-empty">確認病人資料與模型後，由你主動產生摘要。</p>
      ) : null}
      {state.kind === "generating" ? (
        <p className="summary-empty" role="status">正在整理資料並驗證來源，請稍候…</p>
      ) : null}
      {state.kind === "error" ? (
        <p className="summary-error" role="alert">{state.message}</p>
      ) : null}

      {state.kind === "ready" ? (
        <div className="summary-results">
          <p className="summary-meta">
            {state.summary.provenance.model} · {state.summary.generatedAt}
          </p>
          <details className="summary-meta">
            <summary>摘要版本</summary>
            <p>Provider：{state.summary.provenance.providerId}</p>
            <p>Prompt：{state.summary.provenance.promptVersion}</p>
            <p>Schema：{state.summary.provenance.schemaVersion}</p>
            <p>規則：{state.summary.provenance.rulesVersion}</p>
          </details>
          <div className="ai-summary-heading">
            <h3>AI 整理文字</h3>
            <span>已驗證來源引用</span>
          </div>
          {state.summary.items.length === 0 ? (
            <p className="summary-empty">模型沒有產生可驗證的摘要項目。</p>
          ) : (
            <ol className="summary-list">
              {state.summary.items.map((item) => (
                <li key={item.id} className={`summary-item summary-item--${item.importance}`}>
                  <div className="summary-item__heading">
                    <span>{sectionLabels[item.section] ?? item.section}</span>
                    <span>{importanceLabels[item.importance] ?? item.importance}</span>
                  </div>
                  <p>{item.text}</p>
                  <div className="summary-sources">
                    {item.sourceRefs.map((sourceRef) => {
                      const source = sourceById.get(sourceRef);
                      return (
                        <details key={sourceRef}>
                          <summary>查看來源 · {source?.type ?? "record"}</summary>
                          <p>{source?.summary ?? "來源紀錄目前無法顯示。"}</p>
                          {source ? <time dateTime={source.recordedAt}>{source.recordedAt}</time> : null}
                        </details>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
