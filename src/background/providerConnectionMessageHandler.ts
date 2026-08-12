import { z } from "zod";
import { checkProviderConnection, ProviderError } from "../providers";
import {
  TEST_PROVIDER_CONNECTION,
  type ProviderConnectionMessageResponse,
  type TestProviderConnectionMessage,
} from "../shared/providerConnectionMessages";
import { OPENROUTER_PROVIDER_ID } from "../shared/providerSecretMessages";
import type { SummaryProviderFactory } from "./summaryProviderFactory";
import {
  isTrustedExtensionPage,
  type TrustedSender,
} from "./trustedSender";

const DEFAULT_TIMEOUT_MS = 30_000;

function parseMessage(value: Record<string, unknown>): TestProviderConnectionMessage | undefined {
  if (
    value.type !== TEST_PROVIDER_CONNECTION ||
    (value.providerId !== "ollama" &&
      value.providerId !== OPENROUTER_PROVIDER_ID) ||
    typeof value.model !== "string"
  ) {
    return undefined;
  }
  const model = value.model.trim();
  if (!model || model.length > 128 || /[\u0000-\u001f\u007f]/.test(model)) {
    return undefined;
  }
  return {
    type: TEST_PROVIDER_CONNECTION,
    providerId: value.providerId,
    model,
  };
}

function failure(error: unknown): Extract<ProviderConnectionMessageResponse, { ok: false }> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      errorCode: "INVALID_OUTPUT",
      error: "Provider 未通過結構化輸出測試。",
    };
  }
  if (error instanceof ProviderError) {
    if (error.message === "Provider API key is not configured.") {
      return {
        ok: false,
        errorCode: "API_KEY_MISSING",
        error: "尚未設定這個 Provider 的 session API Key。",
      };
    }
    return {
      ok: false,
      errorCode: "PROVIDER_FAILED",
      error: error.status
        ? `Provider 連線測試失敗（HTTP ${error.status}）。`
        : "Provider 連線或模型測試失敗。",
    };
  }
  return {
    ok: false,
    errorCode: "PROVIDER_FAILED",
    error: "Provider 連線或模型測試失敗。",
  };
}

export function createProviderConnectionMessageHandler(options: Readonly<{
  providerFactory: SummaryProviderFactory;
  timeoutMs?: number;
  trustedSender?: TrustedSender;
}>) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const trustedSender = options.trustedSender ?? isTrustedExtensionPage;
  let activeController: AbortController | undefined;

  return async (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<ProviderConnectionMessageResponse | undefined> => {
    if (typeof message !== "object" || message === null) return undefined;
    const raw = message as Record<string, unknown>;
    if (raw.type !== TEST_PROVIDER_CONNECTION) return undefined;
    if (!trustedSender(sender)) {
      return {
        ok: false,
        errorCode: "INVALID_REQUEST",
        error: "這個頁面不能測試 Provider 連線。",
      };
    }
    const request = parseMessage(raw);
    if (!request) {
      return {
        ok: false,
        errorCode: "INVALID_REQUEST",
        error: "Provider 或模型設定不完整。",
      };
    }

    activeController?.abort("replaced");
    const controller = new AbortController();
    activeController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort("timeout");
    }, timeoutMs);

    try {
      const provider = options.providerFactory({
        providerId: request.providerId,
        model: request.model,
      });
      const result = await checkProviderConnection(provider, controller.signal);
      return { ok: true, result };
    } catch (error) {
      if (timedOut) {
        return {
          ok: false,
          errorCode: "TIMED_OUT",
          error: "Provider 連線測試逾時。",
        };
      }
      return failure(error);
    } finally {
      clearTimeout(timeout);
      if (activeController === controller) activeController = undefined;
    }
  };
}
