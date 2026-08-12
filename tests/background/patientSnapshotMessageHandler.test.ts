import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticPatientSnapshot } from "../../src/domain";
import {
  CLEAR_PATIENT_SNAPSHOT,
  GET_PATIENT_SNAPSHOT_STATUS,
  STORE_PATIENT_SNAPSHOT,
} from "../../src/shared/patientSnapshotMessages";
import type { PatientSnapshotStore } from "../../src/background/patientSnapshotStore";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        id: extensionId,
        getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome");
});

function createStore(): PatientSnapshotStore {
  return {
    save: vi.fn(async (snapshot) => ({
      available: true,
      sessionId: snapshot.sessionId,
    })),
    status: vi.fn(async () => ({ available: false })),
    active: vi.fn(async () => undefined),
    clear: vi.fn(async () => ({ available: false })),
  };
}

describe("patient snapshot message handler", () => {
  it("accepts a valid snapshot only from the NHI content script", async () => {
    const { createPatientSnapshotMessageHandler } = await import(
      "../../src/background/patientSnapshotMessageHandler"
    );
    const store = createStore();
    const resetSummary = vi.fn(async () => undefined);
    const handler = createPatientSnapshotMessageHandler(store, { resetSummary });

    const response = await handler(
      { type: STORE_PATIENT_SNAPSHOT, snapshot: syntheticPatientSnapshot, diagnostics: [] },
      {
        id: extensionId,
        url: "https://medcloud2.nhi.gov.tw/imu/example",
        tab: { id: 7 } as chrome.tabs.Tab,
      },
    );

    expect(response?.ok).toBe(true);
    expect(store.save).toHaveBeenCalledWith(syntheticPatientSnapshot, [], 7);
    expect(resetSummary).toHaveBeenCalledOnce();
  });

  it("rejects snapshot injection from an extension page", async () => {
    const { createPatientSnapshotMessageHandler } = await import(
      "../../src/background/patientSnapshotMessageHandler"
    );
    const store = createStore();
    const handler = createPatientSnapshotMessageHandler(store);

    const response = await handler(
      { type: STORE_PATIENT_SNAPSHOT, snapshot: syntheticPatientSnapshot, diagnostics: [] },
      { id: extensionId, url: `chrome-extension://${extensionId}/index.html` },
    );

    expect(response).toEqual({
      ok: false,
      error: "Snapshot update is not allowed from this context.",
    });
    expect(store.save).not.toHaveBeenCalled();
  });

  it("accepts a synthetic snapshot only from an explicitly configured smoke source", async () => {
    const { createPatientSnapshotMessageHandler } = await import(
      "../../src/background/patientSnapshotMessageHandler"
    );
    const store = createStore();
    const handler = createPatientSnapshotMessageHandler(store, {
      contentSources: [
        { origin: "http://127.0.0.1:4173", pathPrefix: "/smoke/" },
      ],
    });

    const accepted = await handler(
      { type: STORE_PATIENT_SNAPSHOT, snapshot: syntheticPatientSnapshot, diagnostics: [] },
      {
        id: extensionId,
        url: "http://127.0.0.1:4173/smoke/index.html",
      },
    );
    const rejected = await handler(
      { type: STORE_PATIENT_SNAPSHOT, snapshot: syntheticPatientSnapshot, diagnostics: [] },
      {
        id: extensionId,
        url: "http://127.0.0.1:4173/not-smoke/index.html",
      },
    );

    expect(accepted?.ok).toBe(true);
    expect(rejected).toEqual({
      ok: false,
      error: "Snapshot update is not allowed from this context.",
    });
    expect(store.save).toHaveBeenCalledOnce();
  });

  it("returns status only to a trusted extension page", async () => {
    const { createPatientSnapshotMessageHandler } = await import(
      "../../src/background/patientSnapshotMessageHandler"
    );
    const store = createStore();
    const handler = createPatientSnapshotMessageHandler(store);

    await expect(
      handler(
        { type: GET_PATIENT_SNAPSHOT_STATUS },
        { id: extensionId, url: `chrome-extension://${extensionId}/index.html` },
      ),
    ).resolves.toEqual({ ok: true, status: { available: false } });
  });

  it("does not clear the current summary for a stale session clear", async () => {
    const { createPatientSnapshotMessageHandler } = await import(
      "../../src/background/patientSnapshotMessageHandler"
    );
    const store = createStore();
    vi.mocked(store.clear).mockResolvedValue({
      available: true,
      sessionId: "current-session",
    });
    const resetSummary = vi.fn(async () => undefined);
    const handler = createPatientSnapshotMessageHandler(store, { resetSummary });

    const response = await handler(
      {
        type: CLEAR_PATIENT_SNAPSHOT,
        sessionId: "stale-session",
        reason: "patient-switch",
      },
      {
        id: extensionId,
        url: "https://medcloud2.nhi.gov.tw/imu/example",
      },
    );

    expect(response).toEqual({
      ok: true,
      status: { available: true, sessionId: "current-session" },
    });
    expect(resetSummary).not.toHaveBeenCalled();
  });
});
