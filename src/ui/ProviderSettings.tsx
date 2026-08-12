import { useEffect, useState } from "react";
import {
  chromeProviderSecretMessaging,
  OPENROUTER_PROVIDER_ID,
  type ProviderId,
  type ProviderSecretMessaging,
} from "./providerMessaging";
import {
  chromeProviderConnectionMessaging,
  type ProviderConnectionMessaging,
} from "./providerConnectionMessaging";

type Feedback = Readonly<{
  tone: "success" | "error";
  text: string;
}>;

type ProviderSettingsProps = Readonly<{
  messaging?: ProviderSecretMessaging;
  provider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  model: string;
  onModelChange: (model: string) => void;
  connectionMessaging?: ProviderConnectionMessaging;
}>;

export function ProviderSettings({
  messaging = chromeProviderSecretMessaging,
  provider,
  onProviderChange,
  model,
  onModelChange,
  connectionMessaging = chromeProviderConnectionMessaging,
}: ProviderSettingsProps) {
  const [secret, setSecret] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionFeedback, setConnectionFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSecret("");
    setFeedback(null);

    if (provider === "ollama") {
      setConfigured(null);
      setChecking(false);
      return () => {
        cancelled = true;
      };
    }

    setConfigured(null);
    setChecking(true);

    void messaging
      .send({
        type: "HAS_PROVIDER_SECRET",
        providerId: OPENROUTER_PROVIDER_ID,
      })
      .then((response) => {
        if (cancelled) return;
        if (!response || !response.ok) {
          setConfigured(null);
          setFeedback({
            tone: "error",
            text: "無法查詢目前的 session key 狀態。",
          });
          return;
        }
        setConfigured(response.configured === true);
      })
      .catch(() => {
        if (cancelled) return;
        setConfigured(null);
        setFeedback({
          tone: "error",
          text: "無法查詢目前的 session key 狀態。",
        });
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [messaging, provider]);

  const isBusy = checking || saving || clearing || testingConnection;

  async function testConnection() {
    const selectedModel = model.trim();
    if (!selectedModel) {
      setConnectionFeedback({ tone: "error", text: "請先輸入模型名稱。" });
      return;
    }
    setTestingConnection(true);
    setConnectionFeedback(null);
    try {
      if (
        provider === OPENROUTER_PROVIDER_ID &&
        !(await connectionMessaging.requestRemotePermission())
      ) {
        setConnectionFeedback({
          tone: "error",
          text: "未取得遠端 Provider 網域權限；沒有傳送測試要求或病歷資料。",
        });
        return;
      }
      const response = await connectionMessaging.test({
        type: "TEST_PROVIDER_CONNECTION",
        providerId: provider,
        model: selectedModel,
      });
      if (!response?.ok) {
        setConnectionFeedback({
          tone: "error",
          text: response?.error ?? "Provider 連線測試失敗。",
        });
        return;
      }
      setConnectionFeedback({
        tone: "success",
        text: `連線與結構化輸出測試成功：${response.result.model}`,
      });
    } catch {
      setConnectionFeedback({ tone: "error", text: "Provider 連線測試失敗。" });
    } finally {
      setTestingConnection(false);
    }
  }

  async function saveSecret() {
    const value = secret.trim();
    if (!value) {
      setFeedback({ tone: "error", text: "請輸入 API Key 後再儲存。" });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await messaging.send({
        type: "SET_PROVIDER_SECRET",
        providerId: OPENROUTER_PROVIDER_ID,
        apiKey: value,
      });
      if (!response || !response.ok) {
        setFeedback({ tone: "error", text: "API Key 尚未儲存，請稍後再試。" });
        return;
      }
      setSecret("");
      setConfigured(true);
      setFeedback({ tone: "success", text: "API Key 已儲存於本次工作階段。" });
    } catch {
      setFeedback({ tone: "error", text: "API Key 尚未儲存，請稍後再試。" });
    } finally {
      setSaving(false);
    }
  }

  async function clearSecret() {
    setClearing(true);
    setFeedback(null);
    try {
      const response = await messaging.send({
        type: "CLEAR_PROVIDER_SECRET",
        providerId: OPENROUTER_PROVIDER_ID,
      });
      if (!response || !response.ok) {
        setFeedback({ tone: "error", text: "API Key 尚未清除，請稍後再試。" });
        return;
      }
      setSecret("");
      setConfigured(false);
      setFeedback({ tone: "success", text: "API Key 已從本次工作階段清除。" });
    } catch {
      setFeedback({ tone: "error", text: "API Key 尚未清除，請稍後再試。" });
    } finally {
      setClearing(false);
    }
  }

  const configuredLabel = checking
    ? "查詢中…"
    : configured === true
      ? "已設定 session key"
      : configured === false
        ? "尚未設定 session key"
        : "尚未查詢";

  return (
    <section className="provider-settings" aria-labelledby="provider-settings-title">
      <div className="section-heading provider-settings__heading">
        <div>
          <p className="section-heading__eyebrow">Provider</p>
          <h2 id="provider-settings-title">摘要 Provider</h2>
        </div>
        <span className="session-pill">只保留於 session</span>
      </div>

      <fieldset className="provider-options">
        <legend className="sr-only">選擇摘要 Provider</legend>
        <label className={`provider-option${provider === "ollama" ? " provider-option--selected" : ""}`}>
          <input
            type="radio"
            name="provider"
            value="ollama"
            checked={provider === "ollama"}
            onChange={() => {
              setConnectionFeedback(null);
              onProviderChange("ollama");
            }}
          />
          <span>
            <strong>Ollama</strong>
            <small>本機處理，不需要 API Key</small>
          </span>
        </label>
        <label
          className={`provider-option${
            provider === OPENROUTER_PROVIDER_ID ? " provider-option--selected" : ""
          }`}
        >
          <input
            type="radio"
            name="provider"
            value={OPENROUTER_PROVIDER_ID}
            checked={provider === OPENROUTER_PROVIDER_ID}
            onChange={() => {
              setConnectionFeedback(null);
              onProviderChange(OPENROUTER_PROVIDER_ID);
            }}
          />
          <span>
            <strong>OpenRouter BYOK</strong>
            <small>固定使用 openai/gpt-oss-120b</small>
          </span>
        </label>
      </fieldset>

      <label className="provider-secret-form__label provider-model-label" htmlFor="provider-model">
        模型名稱
      </label>
      <input
        id="provider-model"
        className="provider-secret-form__input"
        type="text"
        autoComplete="off"
        value={model}
        maxLength={128}
        readOnly={provider === OPENROUTER_PROVIDER_ID}
        onChange={(event) => {
          setConnectionFeedback(null);
          onModelChange(event.target.value);
        }}
        placeholder="輸入本機模型名稱"
      />
      <div className="provider-connection-test">
        <button
          className="button button--secondary"
          type="button"
          disabled={isBusy || !model.trim()}
          onClick={() => void testConnection()}
        >
          {testingConnection ? "測試中…" : "測試 Provider 連線"}
        </button>
        <p>只傳送固定的 JSON 格式測試，不包含病人快照或病歷內容。</p>
        {connectionFeedback ? (
          <p
            className={`provider-feedback provider-feedback--${connectionFeedback.tone}`}
            role="status"
          >
            {connectionFeedback.text}
          </p>
        ) : null}
      </div>

      {provider === "ollama" ? (
        <p className="provider-settings__local-note">
          Ollama 使用本機端點；第一次摘要前仍會先顯示連線與資料外送狀態。
        </p>
      ) : (
        <form
          className="provider-secret-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSecret();
          }}
        >
          <div className="provider-secret-form__status" aria-live="polite">
            <span className="provider-secret-form__status-label">設定狀態</span>
            <strong>{configuredLabel}</strong>
          </div>
          <label className="provider-secret-form__label" htmlFor="provider-secret">
            API Key
          </label>
          <input
            id="provider-secret"
            className="provider-secret-form__input"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="輸入後僅存於本次工作階段"
            aria-describedby="provider-secret-help"
          />
          <p id="provider-secret-help" className="provider-secret-form__help">
            儲存只會設定 OpenRouter session key，不會傳送病歷資料。
          </p>
          <div className="provider-secret-form__actions">
            <button className="button button--primary" type="submit" disabled={isBusy || !secret.trim()}>
              {saving ? "儲存中…" : "儲存 session key"}
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void clearSecret()}
              disabled={isBusy}
            >
              {clearing ? "清除中…" : "清除"}
            </button>
          </div>
          {feedback ? (
            <p className={`provider-feedback provider-feedback--${feedback.tone}`} role="status">
              {feedback.text}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
