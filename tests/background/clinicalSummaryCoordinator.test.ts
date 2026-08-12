import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticPatientSnapshot } from "../../src/domain";
import type { SummaryProvider } from "../../src/providers";
import {
  ClinicalSummaryCoordinatorError,
  createClinicalSummaryCoordinator,
  type SummarySessionStoragePort,
} from "../../src/background/clinicalSummaryCoordinator";

function createMemoryStorage(): SummarySessionStoragePort {
  const values: Record<string, unknown> = {};
  return {
    async get(key: string) {
      return key in values ? { [key]: values[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, items);
    },
    async remove(key: string) {
      delete values[key];
    },
  } as SummarySessionStoragePort;
}

function output(sourceRef = syntheticPatientSnapshot.records[0].id) {
  return {
    items: [
      {
        id: "summary-1",
        section: "medication",
        text: "合成用藥摘要。",
        sourceRefs: [sourceRef],
        importance: "routine",
      },
      {
        id: "summary-2",
        section: "lab",
        text: "合成檢驗結果有明示異常，請核對來源紀錄。",
        sourceRefs: ["src-lab-001", "src-lab-002"],
        importance: "attention",
      },
    ],
  };
}

function providerWith(outputValue: unknown): SummaryProvider {
  return {
    id: "fake",
    async generateSummary() {
      return { providerId: "fake", model: "fake-model", output: outputValue };
    },
  };
}

function createHarness(provider: SummaryProvider) {
  let active = { snapshot: syntheticPatientSnapshot, diagnostics: [] };
  const storage = createMemoryStorage();
  const coordinator = createClinicalSummaryCoordinator({
    snapshots: { active: async () => active },
    secrets: { load: async () => undefined },
    storage,
    providerFactory: () => provider,
    now: () => new Date("2026-08-11T02:00:00.000Z"),
  });
  return {
    coordinator,
    setActive(next: typeof active) {
      active = next;
    },
  };
}

describe("clinical summary coordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores a validated summary and returns only a popup-safe projection", async () => {
    const { coordinator } = createHarness(providerWith(output()));

    const view = await coordinator.run({
      type: "GENERATE_CLINICAL_SUMMARY",
      providerId: "ollama",
      model: "fake-model",
    });

    expect(view.items[0].text).toBe("合成用藥摘要。");
    expect(view.provenance).toEqual({
      providerId: "fake",
      model: "fake-model",
      promptVersion: "clinical-summary-prompt.v1",
      schemaVersion: "clinical-summary.v1",
      rulesVersion: "clinical-rules.v2",
    });
    expect(view.sources[0]).toMatchObject({
      id: syntheticPatientSnapshot.records[0].id,
      type: syntheticPatientSnapshot.records[0].type,
    });
    expect(view).not.toHaveProperty("patientId");
    expect(view).not.toHaveProperty("sessionId");
    await expect(coordinator.current()).resolves.toEqual(view);
  });

  it("evaluates deterministic facts and signals before calling the provider", async () => {
    const generateSummary = vi.fn<SummaryProvider["generateSummary"]>(async () => ({
      providerId: "fake",
      model: "fake-model",
      output: output(),
    }));
    const { coordinator } = createHarness({ id: "fake", generateSummary });

    await coordinator.run({
      type: "GENERATE_CLINICAL_SUMMARY",
      providerId: "ollama",
      model: "fake-model",
    });

    const prompt = generateSummary.mock.calls[0][0].messages
      .map((message) => message.content)
      .join("\n");
    expect(prompt).toContain('"facts"');
    expect(prompt).toContain('"type":"trend"');
    expect(prompt).toContain('"safetySignals"');
    expect(prompt).toContain('"kind":"abnormal-lab"');
  });

  it("rejects and does not save model output with an unknown source", async () => {
    const { coordinator } = createHarness(providerWith(output("unknown-source")));

    await expect(
      coordinator.run({
        type: "GENERATE_CLINICAL_SUMMARY",
        providerId: "ollama",
        model: "fake-model",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    await expect(coordinator.current()).resolves.toBeUndefined();
  });

  it("requires explicit remote-data consent before creating a BYOK provider", async () => {
    const factory = vi.fn(() => providerWith(output()));
    const coordinator = createClinicalSummaryCoordinator({
      snapshots: {
        active: async () => ({ snapshot: syntheticPatientSnapshot, diagnostics: [] }),
      },
      secrets: { load: async () => "test-only-placeholder" },
      storage: createMemoryStorage(),
      providerFactory: factory,
    });

    await expect(
      coordinator.run({
        type: "GENERATE_CLINICAL_SUMMARY",
        providerId: "openrouter",
        model: "openai/gpt-oss-120b",
      }),
    ).rejects.toMatchObject({ code: "REMOTE_CONSENT_REQUIRED" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("drops a result when the active patient session changes", async () => {
    let resolveProvider!: (value: Awaited<ReturnType<SummaryProvider["generateSummary"]>>) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const provider: SummaryProvider = {
      id: "fake",
      generateSummary: () => {
        markStarted();
        return new Promise((resolve) => { resolveProvider = resolve; });
      },
    };
    const harness = createHarness(provider);
    const pending = harness.coordinator.run({
      type: "GENERATE_CLINICAL_SUMMARY",
      providerId: "ollama",
      model: "fake-model",
    });
    await started;
    harness.setActive({
      snapshot: {
        ...syntheticPatientSnapshot,
        patientId: "different-patient",
        sessionId: "different-session",
        records: [],
      },
      diagnostics: [],
    });
    resolveProvider({ providerId: "fake", model: "fake-model", output: output() });

    await expect(pending).rejects.toMatchObject({ code: "STALE_SESSION" });
    await expect(harness.coordinator.current()).resolves.toBeUndefined();
  });

  it("aborts an in-flight provider when reset", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const provider: SummaryProvider = {
      id: "fake",
      generateSummary: ({ signal }) => {
        markStarted();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      },
    };
    const { coordinator } = createHarness(provider);
    const pending = coordinator.run({
      type: "GENERATE_CLINICAL_SUMMARY",
      providerId: "ollama",
      model: "fake-model",
    });
    await started;
    await coordinator.reset();

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<ClinicalSummaryCoordinatorError>>({ code: "CANCELLED" }),
    );
  });

  it("aborts and reports a safe error when the provider times out", async () => {
    vi.useFakeTimers();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const provider: SummaryProvider = {
      id: "fake",
      generateSummary: ({ signal }) => {
        markStarted();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      },
    };
    const coordinator = createClinicalSummaryCoordinator({
      snapshots: {
        active: async () => ({ snapshot: syntheticPatientSnapshot, diagnostics: [] }),
      },
      secrets: { load: async () => undefined },
      storage: createMemoryStorage(),
      providerFactory: () => provider,
      timeoutMs: 25,
    });
    const pending = coordinator.run({
      type: "GENERATE_CLINICAL_SUMMARY",
      providerId: "ollama",
      model: "fake-model",
    });
    await started;
    const rejection = expect(pending).rejects.toMatchObject({
      code: "TIMED_OUT",
      message: expect.not.stringContaining("aborted"),
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });
});
