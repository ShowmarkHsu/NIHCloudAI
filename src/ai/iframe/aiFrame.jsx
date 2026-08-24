import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { requestOptionalHostPermission } from "./optionalHostPermission";

const NHI_CLOUD_ORIGIN = "https://medcloud2.nhi.gov.tw";
const SCOPE_MESSAGE = "nihcloudai.ai-frame.scope.v1";

const FAMILY_LABELS = Object.freeze({
  encounter: "就醫", "western-medication": "西藥", "chinese-medication": "中藥",
  allergy: "過敏", lab: "檢驗", imaging: "影像", procedure: "處置", discharge: "出院",
});

function coverageCopy(coverage) {
  if (!coverage) return "尚未取得目前 revision 的快照。";
  return Object.entries(FAMILY_LABELS).map(([family, label]) => {
    const state = coverage[family];
    if (!state) return `${label}：未回報`;
    if (state.status === "has-data") return `${label}：${state.recordCount} 筆`;
    if (state.status === "confirmed-empty") return `${label}：已確認無資料`;
    if (state.status === "not-collected") return `${label}：本次未收集`;
    return `${label}：資料缺口`;
  }).join("；");
}

function validScope(value) {
  return value && value.type === SCOPE_MESSAGE &&
    typeof value.sessionId === "string" && /^ds_[A-Za-z0-9_-]{8,}$/.test(value.sessionId) &&
    Number.isSafeInteger(value.revision) && value.revision > 0 &&
    value.contractVersion === "clinical-projection.v1";
}

function copyText(summary) {
  return summary.sections.map((section) => `${section.heading}\n${section.content}`).join("\n\n");
}

function AiFrame() {
  const [scope, setScope] = useState(null);
  const [view, setView] = useState(null);
  const [status, setStatus] = useState("waiting");
  const [summary, setSummary] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [openRouterSecret, setOpenRouterSecret] = useState("");
  const [remoteConsent, setRemoteConsent] = useState(false);
  const sequence = useRef(0);
  const generationEpoch = useRef(0);

  const message = async (nextScope, type, extra = {}) => {
    sequence.current = Math.max(sequence.current + 1, Date.now());
    return chrome.runtime.sendMessage({
      schemaVersion: "ai-capability-message.v1",
      type,
      sessionId: nextScope.sessionId,
      revision: nextScope.revision,
      sequence: sequence.current,
      ...extra,
    });
  };

  const load = async (nextScope) => {
    setStatus("loading");
    const response = await message(nextScope, "iframe.active-revision.read", {
      contractVersion: nextScope.contractVersion,
    });
    if (!response?.accepted) {
      setStatus("stale");
      return;
    }
    setView(response.view);
    setStatus("ready");
  };

  useEffect(() => {
    const receiveScope = (event) => {
      if (event.origin !== NHI_CLOUD_ORIGIN || event.source !== window.parent || !validScope(event.data)) return;
      const nextScope = Object.freeze({
        sessionId: event.data.sessionId,
        revision: event.data.revision,
        contractVersion: event.data.contractVersion,
      });
      setScope(nextScope);
      setView(null);
      setSummary(null);
      setDraft(null);
      setReviewed(false);
      setOpenRouterSecret("");
      setRemoteConsent(false);
      generationEpoch.current += 1;
      void load(nextScope).catch(() => setStatus("stale"));
    };
    window.addEventListener("message", receiveScope);
    return () => window.removeEventListener("message", receiveScope);
  }, []);

  const requestHost = async (provider) => {
    const request = chrome.permissions?.request;
    return typeof request === "function"
      ? requestOptionalHostPermission(request.bind(chrome.permissions), provider)
      : false;
  };

  const generate = async (provider) => {
    if (!scope || status === "generating") return;
    const currentGeneration = ++generationEpoch.current;
    if (!(await requestHost(provider))) {
      if (generationEpoch.current !== currentGeneration) return;
      setStatus("permission-required");
      return;
    }
    if (provider === "openrouter") {
      if (!openRouterSecret || !remoteConsent) {
        setStatus("remote-authorization-required");
        return;
      }
      const stored = await message(scope, "iframe.openrouter.session-secret.set", {secret: openRouterSecret});
      if (generationEpoch.current !== currentGeneration) return;
      if (!stored?.accepted) {
        setStatus("stale");
        return;
      }
      const consented = await message(scope, "iframe.openrouter.consent.grant");
      if (generationEpoch.current !== currentGeneration) return;
      if (!consented?.accepted) {
        setStatus("stale");
        return;
      }
      setOpenRouterSecret("");
    }
    setStatus("generating");
    setSummary(null);
    setDraft(null);
    setReviewed(false);
    const response = await message(scope, "iframe.summary.generate", {provider});
    if (generationEpoch.current !== currentGeneration) return;
    if (!response?.accepted) {
      setStatus("stale");
      return;
    }
    if (response.result?.status !== "completed") {
      setStatus(response.result?.status || "failed");
      return;
    }
    setSummary(response.result.summary);
    setDraft(response.result.summary);
    setStatus("ready-for-review");
  };

  const cancel = async () => {
    if (!scope || status !== "generating") return;
    generationEpoch.current += 1;
    const response = await message(scope, "iframe.summary.discard");
    if (!response?.accepted) {
      setStatus("stale");
      return;
    }
    setSummary(null);
    setDraft(null);
    setReviewed(false);
    setOpenRouterSecret("");
    setRemoteConsent(false);
    setStatus("cancelled");
  };

  const confirmReview = async () => {
    if (!scope || !summary || JSON.stringify(draft) !== JSON.stringify(summary)) return;
    const response = await message(scope, "iframe.summary.review");
    if (!response?.accepted) {
      setStatus("stale");
      return;
    }
    setReviewed(true);
    setStatus("reviewed");
  };

  const copy = async () => {
    if (!scope || !reviewed || !draft) return;
    const response = await message(scope, "iframe.summary.copy");
    if (!response?.accepted) {
      setStatus("stale");
      return;
    }
    await navigator.clipboard.writeText(copyText(draft));
    setStatus("copied");
  };

  const edit = (index, content) => {
    if (!draft) return;
    setDraft({
      ...draft,
      sections: draft.sections.map((section, sectionIndex) => sectionIndex === index ? {...section, content} : section),
    });
    setReviewed(false);
    setStatus("edited");
  };

  return <main style={{fontFamily: "system-ui, sans-serif", padding: 12, color: "#1d2939"}}>
    <h2 style={{fontSize: 18, margin: "0 0 8px"}}>AI 摘要隔離工作區</h2>
    <p aria-live="polite">{status === "waiting" ? "等待目前資料工作階段。" :
      status === "loading" ? "正在核對目前 revision。" :
      status === "ready" ? "資料已就緒；請主動選擇 provider。" :
      status === "generating" ? "正在生成完整摘要；不會顯示 partial output。" :
      status === "ready-for-review" ? "完整摘要已通過固定格式驗證，請 review。" :
      status === "reviewed" || status === "copied" ? "已 review；可複製目前版本。" :
      status === "edited" ? "編輯已使 review/copy 失效；請還原為已驗證版本或重新生成。" :
      status === "cancelled" ? "已取消生成；沒有可複製內容。" :
      status === "permission-required" ? "未授予所選 provider 的可選主機權限。" :
      status === "remote-authorization-required" ? "遠端摘要需要本次 session 的 BYOK 與明確同意。" :
      status === "transport-failed" ? "無法連線至 Provider；沒有可複製內容。" :
      status === "response-unreadable" ? "Provider 回應無法安全讀取；沒有可複製內容。" :
      status === "provider-http-failed" ? "Provider 拒絕請求；沒有可複製內容。" :
      status === "provider-output-missing" ? "Provider 未回傳可驗證的摘要內容；沒有可複製內容。" :
      status === "provider-output-truncated" ? "Provider 回應未完整結束；沒有可複製內容。" :
      status === "validation-structure-failed" ? "Provider 回應的 JSON 結構未通過驗證；沒有可複製內容。" :
      status === "validation-alias-failed" ? "Provider 回應的來源代號未通過驗證；沒有可複製內容。" :
      status === "validation-content-failed" ? "Provider 回應的內容政策未通過驗證；沒有可複製內容。" :
      status === "validation-length-failed" ? "Provider 回應的中文字數未通過驗證；沒有可複製內容。" :
      status === "stale" ? "資料工作階段已變更；舊快照與摘要不可使用。" : "生成失敗，沒有可複製內容。"}</p>
    <section aria-label="目前快照 coverage">
      <strong>Coverage</strong><p>{coverageCopy(view?.coverage)}</p>
      {view?.sourceAliases?.length > 0 && <p>可核對來源：{view.sourceAliases.map((source) => source.label).join("、")}</p>}
    </section>
    <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12}}>
      <button type="button" onClick={() => void generate("ollama")} disabled={!scope || status === "generating"}>生成本機 Ollama 摘要</button>
      <button type="button" onClick={() => void generate("openrouter")} disabled={!scope || status === "generating"}>生成遠端 OpenRouter 摘要</button>
      <button type="button" onClick={() => void cancel()} disabled={status !== "generating"}>取消生成</button>
      <button type="button" onClick={() => void confirmReview()} disabled={!summary || JSON.stringify(draft) !== JSON.stringify(summary)}>確認 review</button>
      <button type="button" onClick={() => void copy()} disabled={!reviewed}>複製已 review 摘要</button>
    </div>
    <section aria-label="OpenRouter session-only authorization" style={{borderTop: "1px solid #d0d5dd", paddingTop: 10}}>
      <label>本次 session 的 OpenRouter BYOK
        <input type="password" autoComplete="off" value={openRouterSecret} onChange={(event) => setOpenRouterSecret(event.target.value)} />
      </label>
      <label style={{display: "block", marginTop: 4}}>
        <input type="checkbox" checked={remoteConsent} onChange={(event) => setRemoteConsent(event.target.checked)} />
        我同意將此 sealed snapshot 傳送至固定的 OpenRouter route。
      </label>
    </section>
    {draft?.sections?.map((section, index) => <section key={section.heading} style={{borderTop: "1px solid #d0d5dd", marginTop: 12, paddingTop: 10}}>
      <h3 style={{fontSize: 16}}>{section.heading}</h3>
      <textarea aria-label={`${section.heading} 內容`} value={section.content} onChange={(event) => edit(index, event.target.value)} rows={4} style={{boxSizing: "border-box", width: "100%"}} />
      {section.sourceAliases?.length > 0 && <small>可核對來源：{section.sourceAliases.join("、")}</small>}
    </section>)}
  </main>;
}

createRoot(document.getElementById("root")).render(<AiFrame />);
