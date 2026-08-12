import { describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_PATIENT_ID,
  SYNTHETIC_SESSION_ID,
  syntheticClinicalFacts,
  syntheticPatientSnapshot,
  syntheticSafetySignals,
} from "../../src/domain";
import type { SummaryProvider } from "../../src/providers";
import { generateClinicalSummary } from "../../src/summary";

function createProvider(output: unknown): SummaryProvider {
  return {
    id: "fake",
    generateSummary: vi.fn(async () => ({
      providerId: "fake",
      model: "synthetic-model",
      output,
    })),
  };
}

describe("generateClinicalSummary", () => {
  it("returns a source-validated summary with trusted session identity", async () => {
    const provider = createProvider({
      items: [
        {
          id: "summary-item-1",
          section: "medication",
          text: "近期有一筆合成用藥紀錄。",
          sourceRefs: [syntheticPatientSnapshot.records[0].id],
          importance: "routine",
        },
        {
          id: "summary-item-2",
          section: "lab",
          text: "合成檢驗結果有明示異常，請核對來源紀錄。",
          sourceRefs: syntheticSafetySignals[0].sourceRefs,
          importance: syntheticSafetySignals[0].severity,
        },
      ],
    });

    const summary = await generateClinicalSummary({
      snapshot: syntheticPatientSnapshot,
      facts: syntheticClinicalFacts,
      safetySignals: syntheticSafetySignals,
      provider,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(summary).toMatchObject({
      patientId: SYNTHETIC_PATIENT_ID,
      sessionId: SYNTHETIC_SESSION_ID,
      generatedAt: "2026-08-11T00:00:00.000Z",
      provenance: {
        providerId: "fake",
        model: "synthetic-model",
        promptVersion: "clinical-summary-prompt.v1",
        schemaVersion: "clinical-summary.v1",
        rulesVersion: "clinical-rules.v2",
      },
    });
  });

  it("does not send patient or session identity to the provider", async () => {
    const provider = createProvider({ items: [] });

    await generateClinicalSummary({
      snapshot: syntheticPatientSnapshot,
      provider,
    });

    const generate = vi.mocked(provider.generateSummary);
    const request = generate.mock.calls[0][0];
    const prompt = request.messages.map((message) => message.content).join("\n");
    expect(prompt).not.toContain(SYNTHETIC_PATIENT_ID);
    expect(prompt).not.toContain(SYNTHETIC_SESSION_ID);
    expect(request.messages[0].content).toContain(
      "records.sourceRef、facts.id 與 safetySignals.id 不得出現在 text",
    );
  });

  it("rejects model output that cites a source outside the active snapshot", async () => {
    const provider = createProvider({
      items: [
        {
          id: "summary-item-invalid",
          section: "uncertainty",
          text: "這筆內容沒有對應來源。",
          sourceRefs: ["source-not-in-active-snapshot"],
          importance: "attention",
        },
      ],
    });

    await expect(
      generateClinicalSummary({
        snapshot: syntheticPatientSnapshot,
        provider,
      }),
    ).rejects.toThrow(/does not exist in patient snapshot/);
  });

  it("removes standalone internal-id annotations before final validation", async () => {
    const sourceRef = syntheticPatientSnapshot.records[0].id;
    const provider = createProvider({
      items: [
        {
          id: "summary-item-with-inline-id",
          section: "medication",
          text: `近期有一筆合成用藥紀錄（${sourceRef}）。`,
          sourceRefs: [sourceRef],
          importance: "routine",
        },
      ],
    });

    await expect(
      generateClinicalSummary({
        snapshot: syntheticPatientSnapshot,
        provider,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          text: "近期有一筆合成用藥紀錄。",
          sourceRefs: [sourceRef],
        },
      ],
    });
  });

  it("still rejects an internal identifier used as sentence content", async () => {
    const sourceRef = syntheticPatientSnapshot.records[0].id;
    const provider = createProvider({
      items: [
        {
          id: "summary-item-with-semantic-id",
          section: "medication",
          text: `這筆資料的內部識別為 ${sourceRef}，請核對。`,
          sourceRefs: [sourceRef],
          importance: "routine",
        },
      ],
    });

    await expect(
      generateClinicalSummary({
        snapshot: syntheticPatientSnapshot,
        provider,
      }),
    ).rejects.toThrow(/internal identifier/);
  });

  it("removes adjacent source and rule id annotations from one sentence", async () => {
    const trendFact = syntheticClinicalFacts.find((fact) => fact.type === "trend");
    expect(trendFact).toBeDefined();
    if (!trendFact) return;

    const [olderSourceRef, newerSourceRef] = trendFact.sourceRefs;
    const provider = createProvider({
      items: [
        {
          id: "summary-item-with-adjacent-internal-ids",
          section: "lab",
          text: `空腹血糖從 142 mg/dL（${olderSourceRef}）增加至 168 mg/dL（${newerSourceRef}）（${trendFact.id}）。`,
          sourceRefs: trendFact.sourceRefs,
          importance: "attention",
        },
      ],
    });

    await expect(
      generateClinicalSummary({
        snapshot: syntheticPatientSnapshot,
        facts: syntheticClinicalFacts,
        safetySignals: syntheticSafetySignals,
        provider,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          text: "空腹血糖從 142 mg/dL 增加至 168 mg/dL。",
          sourceRefs: trendFact.sourceRefs,
        },
      ],
    });
  });

  it("passes cancellation through the provider seam", async () => {
    const provider = createProvider({ items: [] });
    const controller = new AbortController();

    await generateClinicalSummary({
      snapshot: syntheticPatientSnapshot,
      provider,
      signal: controller.signal,
    });

    expect(vi.mocked(provider.generateSummary).mock.calls[0][0].signal).toBe(
      controller.signal,
    );
  });
});
