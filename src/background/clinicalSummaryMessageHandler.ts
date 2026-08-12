import type {
  ClinicalSummaryErrorCode,
  ClinicalSummaryMessageResponse,
  GenerateClinicalSummaryMessage,
} from "../shared/clinicalSummaryMessages";
import {
  CANCEL_CLINICAL_SUMMARY,
  GENERATE_CLINICAL_SUMMARY,
  GET_CLINICAL_SUMMARY,
} from "../shared/clinicalSummaryMessages";
import { OPENROUTER_PROVIDER_ID } from "../shared/providerSecretMessages";
import {
  ClinicalSummaryCoordinatorError,
  type ClinicalSummaryCoordinator,
} from "./clinicalSummaryCoordinator";
import {
  isTrustedExtensionPage,
  type TrustedSender,
} from "./trustedSender";

function isGenerateMessage(
  value: Record<string, unknown>,
): value is GenerateClinicalSummaryMessage {
  return (
    value.type === GENERATE_CLINICAL_SUMMARY &&
    (value.providerId === "ollama" ||
      value.providerId === OPENROUTER_PROVIDER_ID) &&
    typeof value.model === "string" &&
    (value.remoteDataConsent === undefined ||
      typeof value.remoteDataConsent === "boolean")
  );
}

function safeFailure(
  error: unknown,
): Extract<ClinicalSummaryMessageResponse, { ok: false }> {
  if (error instanceof ClinicalSummaryCoordinatorError) {
    return { ok: false, errorCode: error.code, error: error.message };
  }
  return {
    ok: false,
    errorCode: "INTERNAL_ERROR" satisfies ClinicalSummaryErrorCode,
    error: "無法處理摘要要求，請稍後再試。",
  };
}

export function createClinicalSummaryMessageHandler(
  coordinator: ClinicalSummaryCoordinator,
  options: Readonly<{ trustedSender?: TrustedSender }> = {},
) {
  const trustedSender = options.trustedSender ?? isTrustedExtensionPage;
  return async (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<ClinicalSummaryMessageResponse | undefined> => {
    if (typeof message !== "object" || message === null) return undefined;
    const value = message as Record<string, unknown>;
    if (
      value.type !== GENERATE_CLINICAL_SUMMARY &&
      value.type !== GET_CLINICAL_SUMMARY &&
      value.type !== CANCEL_CLINICAL_SUMMARY
    ) {
      return undefined;
    }

    if (!trustedSender(sender)) {
      return {
        ok: false,
        errorCode: "INVALID_REQUEST",
        error: "這個頁面不能操作摘要。",
      };
    }

    try {
      if (value.type === GET_CLINICAL_SUMMARY) {
        const summary = await coordinator.current();
        return {
          ok: true,
          state: summary ? { kind: "ready", summary } : { kind: "idle" },
        };
      }
      if (value.type === CANCEL_CLINICAL_SUMMARY) {
        await coordinator.reset();
        return { ok: true, state: { kind: "idle" } };
      }
      if (!isGenerateMessage(value)) {
        return {
          ok: false,
          errorCode: "INVALID_REQUEST",
          error: "摘要設定不完整。",
        };
      }
      const summary = await coordinator.run(value);
      return { ok: true, state: { kind: "ready", summary } };
    } catch (error) {
      return safeFailure(error);
    }
  };
}
