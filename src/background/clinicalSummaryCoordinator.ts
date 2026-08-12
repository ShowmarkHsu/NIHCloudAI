import { z } from "zod";
import {
  ClinicalSummarySchema,
  type ClinicalSummary,
  validateClinicalSummaryAgainstSnapshot,
} from "../domain";
import {
  ProviderError,
} from "../providers";
import { generateClinicalSummary } from "../summary";
import { evaluateClinicalRules } from "../rules";
import type {
  ClinicalSummaryErrorCode,
  ClinicalSummaryView,
  GenerateClinicalSummaryMessage,
} from "../shared/clinicalSummaryMessages";
import { OPENROUTER_PROVIDER_ID } from "../shared/providerSecretMessages";
import type { PatientSnapshotStore } from "./patientSnapshotStore";
import type { ProviderSecretVault } from "./sessionSecretVault";
import {
  createSummaryProviderFactory,
  type SummaryProviderFactory,
} from "./summaryProviderFactory";

const ACTIVE_SUMMARY_KEY = "active-clinical-summary";
const DEFAULT_TIMEOUT_MS = 90_000;

export type SummarySessionStoragePort = Pick<
  chrome.storage.StorageArea,
  "get" | "set" | "remove"
>;

export class ClinicalSummaryCoordinatorError extends Error {
  readonly code: ClinicalSummaryErrorCode;

  constructor(code: ClinicalSummaryErrorCode, message: string) {
    super(message);
    this.name = "ClinicalSummaryCoordinatorError";
    this.code = code;
  }
}

export interface ClinicalSummaryCoordinator {
  run(request: GenerateClinicalSummaryMessage): Promise<ClinicalSummaryView>;
  current(): Promise<ClinicalSummaryView | undefined>;
  reset(): Promise<void>;
}

type CoordinatorOptions = Readonly<{
  snapshots: Pick<PatientSnapshotStore, "active">;
  secrets: Pick<ProviderSecretVault, "load">;
  storage?: SummarySessionStoragePort;
  providerFactory?: SummaryProviderFactory;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
}>;

function toView(summary: ClinicalSummary, snapshot: Awaited<ReturnType<PatientSnapshotStore["active"]>>): ClinicalSummaryView {
  if (!snapshot) {
    throw new ClinicalSummaryCoordinatorError(
      "STALE_SESSION",
      "病人資料工作階段已變更，請重新產生摘要。",
    );
  }
  const cited = new Set(summary.items.flatMap((item) => item.sourceRefs));
  return {
    generatedAt: summary.generatedAt,
    provenance: summary.provenance,
    items: summary.items,
    sources: snapshot.snapshot.records
      .filter((record) => cited.has(record.id))
      .map(({ id, type, recordedAt, summary: sourceSummary }) => ({
        id,
        type,
        recordedAt,
        summary: sourceSummary,
      })),
  };
}

function normalizeModel(value: string): string {
  const model = value.trim();
  if (!model || model.length > 128 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new ClinicalSummaryCoordinatorError(
      "INVALID_REQUEST",
      "請輸入有效的模型名稱。",
    );
  }
  return model;
}

function mapProviderError(error: unknown): ClinicalSummaryCoordinatorError {
  if (error instanceof ClinicalSummaryCoordinatorError) return error;
  if (error instanceof z.ZodError) {
    return new ClinicalSummaryCoordinatorError(
      "INVALID_OUTPUT",
      "模型輸出未通過格式或來源驗證，沒有顯示這次結果。",
    );
  }
  if (error instanceof ProviderError) {
    if (error.message === "Provider API key is not configured.") {
      return new ClinicalSummaryCoordinatorError(
        "API_KEY_MISSING",
        "尚未設定這個 Provider 的 session API Key。",
      );
    }
    return new ClinicalSummaryCoordinatorError(
      "PROVIDER_FAILED",
      error.status
        ? `Provider 請求失敗（HTTP ${error.status}）。`
        : "Provider 無法產生摘要，請確認連線與模型設定。",
    );
  }
  return new ClinicalSummaryCoordinatorError(
    "INTERNAL_ERROR",
    "無法產生摘要，請稍後再試。",
  );
}

export function createClinicalSummaryCoordinator(
  options: CoordinatorOptions,
): ClinicalSummaryCoordinator {
  const storage = options.storage ?? chrome.storage.session;
  const providerFactory =
    options.providerFactory ??
    createSummaryProviderFactory({
      secrets: options.secrets,
      fetch: options.fetch,
    });
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let generation = 0;
  let activeController: AbortController | undefined;

  async function removeStored(): Promise<void> {
    await storage.remove(ACTIVE_SUMMARY_KEY);
  }

  async function loadStored(): Promise<ClinicalSummary | undefined> {
    const values = await storage.get(ACTIVE_SUMMARY_KEY);
    const parsed = ClinicalSummarySchema.safeParse(values[ACTIVE_SUMMARY_KEY]);
    return parsed.success ? parsed.data : undefined;
  }

  return {
    async run(request) {
      const model = normalizeModel(request.model);
      if (
        request.providerId === OPENROUTER_PROVIDER_ID &&
        request.remoteDataConsent !== true
      ) {
        throw new ClinicalSummaryCoordinatorError(
          "REMOTE_CONSENT_REQUIRED",
          "使用遠端 Provider 前必須確認病歷資料外送提醒。",
        );
      }

      const active = await options.snapshots.active();
      if (!active) {
        throw new ClinicalSummaryCoordinatorError(
          "NO_SNAPSHOT",
          "請先在健保雲端開啟已授權的病人資料。",
        );
      }

      generation += 1;
      const runGeneration = generation;
      activeController?.abort("replaced");
      const controller = new AbortController();
      activeController = controller;
      await removeStored();

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort("timeout");
      }, timeoutMs);

      try {
        const provider = providerFactory({
          providerId: request.providerId,
          model,
        });
        const ruleEvaluation = evaluateClinicalRules(active.snapshot);
        const summary = await generateClinicalSummary({
          snapshot: active.snapshot,
          facts: ruleEvaluation.facts,
          safetySignals: ruleEvaluation.safetySignals,
          provider,
          signal: controller.signal,
          now,
        });

        const latest = await options.snapshots.active();
        if (
          runGeneration !== generation ||
          controller.signal.aborted ||
          !latest ||
          latest.snapshot.sessionId !== active.snapshot.sessionId
        ) {
          throw new ClinicalSummaryCoordinatorError(
            "STALE_SESSION",
            "病人資料工作階段已變更，已捨棄這次摘要。",
          );
        }

        await storage.set({ [ACTIVE_SUMMARY_KEY]: summary });
        if (runGeneration !== generation || controller.signal.aborted) {
          await removeStored();
          throw new ClinicalSummaryCoordinatorError(
            "STALE_SESSION",
            "病人資料工作階段已變更，已捨棄這次摘要。",
          );
        }
        return toView(summary, latest);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ClinicalSummaryCoordinatorError(
            timedOut ? "TIMED_OUT" : "CANCELLED",
            timedOut
              ? "Provider 回應逾時，沒有保存這次結果。"
              : "摘要已取消。",
          );
        }
        throw mapProviderError(error);
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = undefined;
      }
    },

    async current() {
      const [active, stored] = await Promise.all([
        options.snapshots.active(),
        loadStored(),
      ]);
      if (!active || !stored) return undefined;
      try {
        const summary = validateClinicalSummaryAgainstSnapshot(
          stored,
          active.snapshot,
        );
        return toView(summary, active);
      } catch {
        await removeStored();
        return undefined;
      }
    },

    async reset() {
      generation += 1;
      activeController?.abort("reset");
      activeController = undefined;
      await removeStored();
    },
  };
}
