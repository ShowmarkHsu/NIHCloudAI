import { useState } from "react";
import {
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  type ProviderId,
} from "../shared/providerSecretMessages";
import type { ClinicalRuleMessaging } from "./clinicalRuleMessaging";
import { ClinicalRulePanel } from "./ClinicalRulePanel";
import type { ClinicalSummaryMessaging } from "./clinicalSummaryMessaging";
import { ClinicalSummaryPanel } from "./ClinicalSummaryPanel";
import type { ProviderSecretMessaging } from "./providerMessaging";
import type { PatientSnapshotStatusMessaging } from "./patientSnapshotMessaging";
import { PatientSnapshotStatusCard } from "./PatientSnapshotStatusCard";
import { ProviderSettings } from "./ProviderSettings";
import type { ProviderConnectionMessaging } from "./providerConnectionMessaging";

type StatusTone = "ready" | "waiting";

type StatusCardProps = {
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
};

const statusLabel: Record<StatusTone, string> = {
  ready: "待命",
  waiting: "等待操作",
};

function StatusCard({ label, value, detail, tone }: StatusCardProps) {
  return (
    <article className="status-card">
      <div className="status-card__heading">
        <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
        <h3>{label}</h3>
        <span className={`status-badge status-badge--${tone}`}>{statusLabel[tone]}</span>
      </div>
      <p className="status-card__value">{value}</p>
      <p className="status-card__detail">{detail}</p>
    </article>
  );
}

type AppProps = Readonly<{
  messaging?: ProviderSecretMessaging;
  snapshotMessaging?: PatientSnapshotStatusMessaging;
  summaryMessaging?: ClinicalSummaryMessaging;
  ruleMessaging?: ClinicalRuleMessaging;
  connectionMessaging?: ProviderConnectionMessaging;
}>;

export function App({ messaging, snapshotMessaging, summaryMessaging, ruleMessaging, connectionMessaging }: AppProps = {}) {
  const [provider, setProvider] = useState<ProviderId>("ollama");
  const [models, setModels] = useState<Record<ProviderId, string>>({
    ollama: "",
    [OPENROUTER_PROVIDER_ID]: OPENROUTER_DEFAULT_MODEL,
  });
  const model = models[provider];

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-mark" aria-hidden="true">
          <span>NI</span>
        </div>
        <div>
          <p className="app-kicker">Clinical summary assistant</p>
          <h1>NICloudAI</h1>
        </div>
      </header>

      <section className="intro" aria-labelledby="intro-title">
        <p className="intro__eyebrow">隱私優先 · 可回查來源</p>
        <h2 id="intro-title">讓近期病歷一目了然</h2>
        <p>
          先確認目前的病人資料，再由你主動啟動摘要。沒有操作時，不會自動外送任何病歷資料。
        </p>
      </section>

      <ProviderSettings
        messaging={messaging}
        provider={provider}
        onProviderChange={setProvider}
        model={model}
        onModelChange={(value) =>
          setModels((current) => ({ ...current, [provider]: value }))
        }
        connectionMessaging={connectionMessaging}
      />

      <section className="status-section" aria-labelledby="status-title">
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">Workspace</p>
            <h2 id="status-title">目前狀態</h2>
          </div>
          <span className="session-pill">本次工作階段</span>
        </div>

        <div className="status-grid">
          <PatientSnapshotStatusCard messaging={snapshotMessaging} />
          <StatusCard
            label="摘要 Provider"
            value={provider === "ollama" ? "本機 Ollama" : "OpenRouter BYOK"}
            detail={model.trim() ? `模型：${model.trim()}` : "請輸入模型名稱後再產生摘要。"}
            tone={model.trim() ? "ready" : "waiting"}
          />
          <StatusCard
            label="安全檢查"
            value="已啟用"
            detail="API Key 僅限 trusted extension session 使用。"
            tone="ready"
          />
        </div>
      </section>

      <ClinicalRulePanel messaging={ruleMessaging} />

      <ClinicalSummaryPanel
        provider={provider}
        model={model}
        messaging={summaryMessaging}
      />

      <footer className="app-footer">
        <span className="footer-lock" aria-hidden="true">⌁</span>
        <span>資料只在你主動操作的工作階段中處理</span>
      </footer>
    </main>
  );
}
