import { syntheticPatientSnapshot, type PatientSnapshot } from "../domain";
import {
  CLEAR_PATIENT_SNAPSHOT,
  STORE_PATIENT_SNAPSHOT,
  type PatientSnapshotMessageResponse,
} from "../shared/patientSnapshotMessages";
import {
  GET_CLINICAL_RULE_RESULTS,
  type ClinicalRuleMessageResponse,
} from "../shared/clinicalRuleMessages";
import {
  CANCEL_CLINICAL_SUMMARY,
  GENERATE_CLINICAL_SUMMARY,
  GET_CLINICAL_SUMMARY,
  type ClinicalSummaryMessageResponse,
  type ClinicalSummaryView,
  type SummarySourcePreview,
} from "../shared/clinicalSummaryMessages";
import {
  TEST_PROVIDER_CONNECTION,
  type ProviderConnectionMessageResponse,
} from "../shared/providerConnectionMessages";
import { assertNoInternalIdentifiersInSummary } from "./summaryAssertions";

const SMOKE_ORIGIN = "http://127.0.0.1:4173";
const SMOKE_PATH_PREFIX = "/smoke/";
const MISSING_MODEL = "nicloudai-smoke-model-does-not-exist";

type SyntheticPatient = "a" | "b";

let generation = 0;
let activeSnapshot: PatientSnapshot | undefined;
let operation = Promise.resolve();

function createSnapshot(patient: SyntheticPatient): PatientSnapshot {
  generation += 1;
  const patientId = `patient-smoke-${patient}`;
  const sessionId = `session-smoke-${patient}-${generation}`;
  const suffix = `smoke-${patient}-${generation}`;
  return {
    patientId,
    sessionId,
    capturedAt: new Date().toISOString(),
    records: syntheticPatientSnapshot.records.map((record) => ({
      ...record,
      id: `${record.id}-${suffix}`,
      patientId,
      sessionId,
      data: { ...record.data, synthetic: true },
    })),
  };
}

function setPageState(state: string): void {
  const status = document.querySelector<HTMLElement>("[data-nicloudai-smoke-status]");
  if (status) status.textContent = state;
}

async function send<T>(message: unknown): Promise<T> {
  return await chrome.runtime.sendMessage(message) as T;
}

async function clearSnapshot(
  snapshot: PatientSnapshot,
  reason: "patient-switch" | "logout" | "page-unload",
): Promise<void> {
  const response = await send<PatientSnapshotMessageResponse>({
    type: CLEAR_PATIENT_SNAPSHOT,
    sessionId: snapshot.sessionId,
    reason,
  });
  if (!response?.ok) throw new Error("Synthetic snapshot clear was rejected.");
}

async function publish(patient: SyntheticPatient): Promise<void> {
  const previous = activeSnapshot;
  if (previous) await clearSnapshot(previous, "patient-switch");

  const snapshot = createSnapshot(patient);
  const response = await send<PatientSnapshotMessageResponse>({
    type: STORE_PATIENT_SNAPSHOT,
    snapshot,
    diagnostics: [
      {
        source: "other",
        level: "info",
        message: "Synthetic smoke snapshot loaded.",
      },
    ],
  });
  if (!response?.ok) throw new Error("Synthetic snapshot update was rejected.");
  activeSnapshot = snapshot;
  const summary = await send<ClinicalSummaryMessageResponse>({
    type: GET_CLINICAL_SUMMARY,
  });
  if (!summary?.ok || summary.state.kind !== "idle") {
    throw new Error("Patient switch did not clear the previous summary.");
  }
  if (previous) {
    setResult("summary", "通過：病人切換後，前一工作階段的摘要已清除。", "pass");
  }
  setPageState(`合成病人 ${patient.toUpperCase()} 已發布；舊摘要已清除。`);
}

async function clearActive(): Promise<void> {
  if (!activeSnapshot) return;
  await clearSnapshot(activeSnapshot, "logout");
  activeSnapshot = undefined;
  const rules = await send<ClinicalRuleMessageResponse>({
    type: GET_CLINICAL_RULE_RESULTS,
  });
  if (!rules?.ok || rules.state.kind !== "unavailable") {
    throw new Error("Cleared smoke session remained available.");
  }
  setResult("rules", "通過：工作階段清除後，規則資料已不可用。", "pass");
  setResult("summary", "通過：工作階段清除後，摘要已不可用。", "pass");
  setPageState("合成病人工作階段已清除；規則資料已不可用。");
}

function enqueue(task: () => Promise<void>): void {
  operation = operation
    .then(task)
    .catch(() => setPageState("合成 smoke 操作失敗，請重新載入測試頁。"));
}

function installExtensionLink(): void {
  const container = document.querySelector<HTMLElement>("[data-nicloudai-smoke-extension]");
  if (!container) return;
  const link = document.createElement("a");
  link.href = chrome.runtime.getURL("index.html");
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "開啟 NICloudAI 擴充功能 UI";
  link.dataset.testid = "open-extension-ui";
  container.replaceChildren(link);
}

function model(): string {
  return document.querySelector<HTMLInputElement>("[data-smoke-model]")?.value.trim() ?? "";
}

function resultContainer(name: string): HTMLElement {
  const container = document.querySelector<HTMLElement>(`[data-smoke-result="${name}"]`);
  if (!container) throw new Error(`Missing smoke result container: ${name}`);
  return container;
}

function setResult(name: string, text: string, tone: "working" | "pass" | "fail" = "working"): void {
  const container = resultContainer(name);
  container.replaceChildren();
  container.textContent = text;
  container.dataset.tone = tone;
}

function sourceDetails(source: SummarySourcePreview): HTMLDetailsElement {
  const details = document.createElement("details");
  const label = document.createElement("summary");
  label.textContent = `查看合成來源 · ${source.type}`;
  const text = document.createElement("p");
  text.textContent = source.summary;
  const time = document.createElement("time");
  time.dateTime = source.recordedAt;
  time.textContent = source.recordedAt;
  details.append(label, text, time);
  return details;
}

function renderRules(response: ClinicalRuleMessageResponse): void {
  if (!response?.ok || response.state.kind !== "ready") {
    throw new Error(response && !response.ok ? response.error : "Rules are unavailable.");
  }
  const { facts, safetySignals, sources } = response.state.result;
  const container = resultContainer("rules");
  container.replaceChildren();
  const status = document.createElement("p");
  status.textContent = `通過：${facts.length} 個臨床事實、${safetySignals.length} 個安全訊號、${sources.length} 個引用來源。`;
  container.append(status, ...sources.map(sourceDetails));
  container.dataset.tone = "pass";
}

function renderSummary(summary: ClinicalSummaryView): void {
  const sourceById = new Map(summary.sources.map((source) => [source.id, source]));
  const container = resultContainer("summary");
  container.replaceChildren();
  const status = document.createElement("p");
  status.textContent = `通過：${summary.items.length} 個 AI 摘要項目、${summary.sources.length} 個已驗證來源。`;
  const list = document.createElement("ol");
  for (const item of summary.items) {
    const row = document.createElement("li");
    const text = document.createElement("p");
    text.textContent = item.text;
    row.append(text);
    for (const sourceRef of item.sourceRefs) {
      const source = sourceById.get(sourceRef);
      if (!source) throw new Error("A rendered summary source is missing.");
      row.append(sourceDetails(source));
    }
    list.append(row);
  }
  container.append(status, list);
  container.dataset.tone = "pass";
}

async function testRules(): Promise<void> {
  setResult("rules", "正在計算確定性規則…");
  renderRules(await send<ClinicalRuleMessageResponse>({ type: GET_CLINICAL_RULE_RESULTS }));
}

async function testConnection(): Promise<void> {
  const selectedModel = model();
  if (!selectedModel) throw new Error("請輸入已安裝的本機模型名稱。");
  setResult("connection", "正在執行固定的無病歷連線測試…");
  const response = await send<ProviderConnectionMessageResponse>({
    type: TEST_PROVIDER_CONNECTION,
    providerId: "ollama",
    model: selectedModel,
  });
  if (!response?.ok) throw new Error(response?.error ?? "Connection test failed.");
  setResult("connection", `通過：本機 Ollama 結構化輸出可用（${response.result.model}）。`, "pass");
}

async function testSummary(): Promise<void> {
  const selectedModel = model();
  if (!selectedModel) throw new Error("請輸入已安裝的本機模型名稱。");
  setResult("summary", "正在由本機 Ollama 產生摘要並驗證來源…");
  const response = await send<ClinicalSummaryMessageResponse>({
    type: GENERATE_CLINICAL_SUMMARY,
    providerId: "ollama",
    model: selectedModel,
  });
  if (!response?.ok || response.state.kind !== "ready") {
    throw new Error(response && !response.ok ? response.error : "Summary was not ready.");
  }
  const rules = await send<ClinicalRuleMessageResponse>({
    type: GET_CLINICAL_RULE_RESULTS,
  });
  if (!activeSnapshot || !rules?.ok || rules.state.kind !== "ready") {
    throw new Error("Internal identifier validation context is unavailable.");
  }
  assertNoInternalIdentifiersInSummary(response.state.summary, [
    activeSnapshot.patientId,
    activeSnapshot.sessionId,
    ...activeSnapshot.records.map((record) => record.id),
    ...rules.state.result.facts.map((fact) => fact.id),
    ...rules.state.result.safetySignals.map((signal) => signal.id),
  ]);
  renderSummary(response.state.summary);
}

async function testCancellation(): Promise<void> {
  const selectedModel = model();
  if (!selectedModel) throw new Error("請輸入已安裝的本機模型名稱。");
  setResult("cancellation", "正在啟動並取消本機摘要請求…");
  const generation = send<ClinicalSummaryMessageResponse>({
    type: GENERATE_CLINICAL_SUMMARY,
    providerId: "ollama",
    model: selectedModel,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const cancellation = await send<ClinicalSummaryMessageResponse>({
    type: CANCEL_CLINICAL_SUMMARY,
  });
  const cancelledGeneration = await generation;
  if (
    !cancellation?.ok ||
    cancellation.state.kind !== "idle" ||
    cancelledGeneration?.ok ||
    cancelledGeneration.errorCode !== "CANCELLED"
  ) {
    throw new Error("Summary cancellation did not return the expected safe state.");
  }
  setResult("cancellation", "通過：請求已取消，未保留摘要結果。", "pass");
}

async function testError(): Promise<void> {
  setResult("error", "正在驗證不存在模型的安全錯誤…");
  const response = await send<ProviderConnectionMessageResponse>({
    type: TEST_PROVIDER_CONNECTION,
    providerId: "ollama",
    model: MISSING_MODEL,
  });
  if (response?.ok || response?.errorCode !== "PROVIDER_FAILED") {
    throw new Error("Missing model did not return the expected provider error.");
  }
  setResult("error", `通過：${response.error}`, "pass");
}

function bindButton(selector: string, task: () => Promise<void>, resultName?: string): void {
  document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", () => {
    void task().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Smoke action failed.";
      if (resultName) setResult(resultName, `失敗：${message}`, "fail");
      else setPageState(`合成 smoke 操作失敗：${message}`);
    });
  });
}

function installSmokeControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-patient]").forEach((button) => {
    button.addEventListener("click", () => {
      const patient = button.dataset.patient;
      if (patient === "a" || patient === "b") enqueue(() => publish(patient));
    });
  });
  bindButton("[data-clear]", clearActive);
  bindButton("[data-smoke-action='rules']", testRules, "rules");
  bindButton("[data-smoke-action='connection']", testConnection, "connection");
  bindButton("[data-smoke-action='summary']", testSummary, "summary");
  bindButton("[data-smoke-action='cancellation']", testCancellation, "cancellation");
  bindButton("[data-smoke-action='error']", testError, "error");
}

if (window.location.origin === SMOKE_ORIGIN && window.location.pathname.startsWith(SMOKE_PATH_PREFIX)) {
  installExtensionLink();
  installSmokeControls();
  window.addEventListener(
    "pagehide",
    () => {
      const snapshot = activeSnapshot;
      if (snapshot) void clearSnapshot(snapshot, "page-unload");
    },
    { once: true },
  );
  enqueue(() => publish("a"));
}
