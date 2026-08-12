import { PatientSnapshotSchema } from "../domain";
import {
  CLEAR_PATIENT_SNAPSHOT,
  GET_PATIENT_SNAPSHOT_STATUS,
  STORE_PATIENT_SNAPSHOT,
  type PatientSnapshotMessageResponse,
  type SnapshotDiagnostic,
} from "../shared/patientSnapshotMessages";
import type { PatientSnapshotStore } from "./patientSnapshotStore";

export type SnapshotContentSource = Readonly<{
  origin: string;
  pathPrefix: string;
}>;

export const NHI_SNAPSHOT_CONTENT_SOURCE: SnapshotContentSource = {
  origin: "https://medcloud2.nhi.gov.tw",
  pathPrefix: "/imu/",
};

function isTrustedExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.url?.startsWith(chrome.runtime.getURL("")) === true
  );
}

function isAllowedContentScript(
  sender: chrome.runtime.MessageSender,
  sources: readonly SnapshotContentSource[],
): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return sources.some(
      (source) =>
        url.origin === source.origin && url.pathname.startsWith(source.pathPrefix),
    );
  } catch {
    return false;
  }
}

function isDiagnostics(value: unknown): value is readonly SnapshotDiagnostic[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.source === "string" &&
        (item.level === "info" || item.level === "warning") &&
        typeof item.message === "string",
    )
  );
}

type SnapshotLifecycle = Readonly<{
  resetSummary?: () => Promise<void> | void;
  contentSources?: readonly SnapshotContentSource[];
}>;

export function createPatientSnapshotMessageHandler(
  store: PatientSnapshotStore,
  lifecycle: SnapshotLifecycle = {},
) {
  const contentSources = lifecycle.contentSources ?? [NHI_SNAPSHOT_CONTENT_SOURCE];
  return async (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<PatientSnapshotMessageResponse | undefined> => {
    if (typeof message !== "object" || message === null) return undefined;
    const value = message as Record<string, unknown>;

    if (value.type === GET_PATIENT_SNAPSHOT_STATUS) {
      if (!isTrustedExtensionPage(sender)) {
        return { ok: false, error: "Snapshot status is not allowed from this context." };
      }
      return { ok: true, status: await store.status() };
    }

    if (value.type === STORE_PATIENT_SNAPSHOT) {
      if (!isAllowedContentScript(sender, contentSources)) {
        return { ok: false, error: "Snapshot update is not allowed from this context." };
      }
      const parsed = PatientSnapshotSchema.safeParse(value.snapshot);
      if (!parsed.success || !isDiagnostics(value.diagnostics)) {
        return { ok: false, error: "Snapshot update is invalid." };
      }
      const status = await store.save(
        parsed.data,
        value.diagnostics,
        sender.tab?.id,
      );
      await lifecycle.resetSummary?.();
      return { ok: true, status };
    }

    if (value.type === CLEAR_PATIENT_SNAPSHOT) {
      if (!isAllowedContentScript(sender, contentSources) || typeof value.sessionId !== "string") {
        return { ok: false, error: "Snapshot clear is not allowed from this context." };
      }
      const status = await store.clear(value.sessionId);
      if (!status.available) await lifecycle.resetSummary?.();
      return { ok: true, status };
    }

    return undefined;
  };
}
