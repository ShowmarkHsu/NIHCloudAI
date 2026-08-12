import { describe, expect, it, vi } from "vitest";
import {
  createContentBridge,
  type ContentBridgeDependencies,
  type DataSession,
  type PatientContext,
  type SnapshotFetchResult,
} from "../../src/content/contentBridge";

function createSnapshot(session: DataSession): SnapshotFetchResult["snapshot"] {
  return {
    patientId: session.patientId,
    sessionId: session.sessionId,
    capturedAt: "2026-08-11T00:00:00.000Z",
    records: [],
  };
}

function createHarness(initialContext: PatientContext | null = {
  sourcePatientKey: "source-a",
}) {
  let context = initialContext;
  let active: DataSession | undefined;
  let activeController: AbortController | undefined;
  let nextId = 0;
  const scheduler = {
    setInterval: vi.fn(() => "poll-handle"),
    clearInterval: vi.fn(),
  };
  const session = {
    activate: vi.fn((sourcePatientKey: string): DataSession => {
      const controller = new AbortController();
      activeController = controller;
      active = {
        patientId: `opaque-patient-${++nextId}`,
        sessionId: `opaque-session-${nextId}`,
        signal: controller.signal,
      };
      // Keep the source key in the fake only to model the real manager's
      // switch behaviour; the bridge never publishes it.
      void sourcePatientKey;
      return active;
    }),
    isCurrent: vi.fn((sessionId: string) => active?.sessionId === sessionId),
    end: vi.fn(() => {
      activeController?.abort();
      activeController = undefined;
      active = undefined;
    }),
  };
  const adapter = {
    inspectPatientContext: vi.fn(() => context),
    fetchSnapshot: vi.fn(async (_patientId: string, sessionId: string) => {
      const sessionValue: DataSession = {
        patientId: "opaque",
        sessionId,
        signal: new AbortController().signal,
      };
      return {
        snapshot: createSnapshot(sessionValue),
        diagnostics: [],
      };
    }),
  };
  const publisher = {
    store: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };

  const dependencies: ContentBridgeDependencies = {
    adapter,
    session,
    publisher,
    scheduler,
  };

  return {
    bridge: createContentBridge(dependencies),
    adapter,
    publisher,
    scheduler,
    session,
    setContext(value: PatientContext | null) {
      context = value;
    },
    getActive() {
      return active;
    },
  };
}

describe("content bridge", () => {
  it("captures and publishes the initial authorized patient snapshot", async () => {
    const harness = createHarness();

    await harness.bridge.start();

    expect(harness.scheduler.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      1_500,
    );
    expect(harness.session.activate).toHaveBeenCalledWith("source-a");
    expect(harness.adapter.fetchSnapshot).toHaveBeenCalledWith(
      "opaque-patient-1",
      "opaque-session-1",
      expect.any(AbortSignal),
    );
    expect(harness.publisher.store).toHaveBeenCalledTimes(1);
  });

  it("coalesces same-patient refreshes and does not refetch a published snapshot", async () => {
    const harness = createHarness();
    await harness.bridge.start();

    await Promise.all([
      harness.bridge.refresh(),
      harness.bridge.refresh(),
      harness.bridge.refresh(),
    ]);

    expect(harness.adapter.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.publisher.store).toHaveBeenCalledTimes(1);
  });

  it("aborts and clears the old session before capturing a switched patient", async () => {
    const harness = createHarness();
    await harness.bridge.start();
    const oldSession = harness.getActive();
    harness.setContext({ sourcePatientKey: "source-b" });

    await harness.bridge.refresh();

    expect(oldSession?.signal.aborted).toBe(true);
    expect(harness.session.end).toHaveBeenCalledWith("patient-switch");
    expect(harness.publisher.clear).toHaveBeenCalledWith(
      "opaque-session-1",
      "patient-switch",
    );
    expect(harness.session.activate).toHaveBeenLastCalledWith("source-b");
    expect(harness.adapter.fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it("never publishes a fetch that becomes stale after stop", async () => {
    const harness = createHarness();
    let resolveFetch!: (result: SnapshotFetchResult) => void;
    harness.adapter.fetchSnapshot.mockImplementationOnce(
      () =>
        new Promise<SnapshotFetchResult>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const startPromise = harness.bridge.start();
    await Promise.resolve();
    await harness.bridge.stop();

    resolveFetch({
      snapshot: {
        patientId: "opaque-patient-1",
        sessionId: "opaque-session-1",
        capturedAt: "2026-08-11T00:00:00.000Z",
        records: [],
      },
      diagnostics: [],
    });
    await startPromise;
    await Promise.resolve();

    expect(harness.publisher.store).not.toHaveBeenCalled();
    expect(harness.publisher.clear).toHaveBeenCalledWith(
      "opaque-session-1",
      "page-unload",
    );
  });

  it("clears the active session when authorization disappears", async () => {
    const harness = createHarness();
    await harness.bridge.start();
    harness.setContext(null);

    await harness.bridge.refresh();

    expect(harness.session.end).toHaveBeenCalledWith("authorization-expired");
    expect(harness.publisher.clear).toHaveBeenCalledWith(
      "opaque-session-1",
      "authorization-expired",
    );
  });
});
