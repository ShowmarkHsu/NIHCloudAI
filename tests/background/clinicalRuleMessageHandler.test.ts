import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  syntheticClinicalFacts,
  syntheticPatientSnapshot,
  syntheticSafetySignals,
} from "../../src/domain";
import { GET_CLINICAL_RULE_RESULTS } from "../../src/shared/clinicalRuleMessages";

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

describe("clinical rule message handler", () => {
  it("returns a source-backed view without patient or session identity", async () => {
    const { createClinicalRuleMessageHandler } = await import(
      "../../src/background/clinicalRuleMessageHandler"
    );
    const handler = createClinicalRuleMessageHandler(
      {
        active: async () => ({ snapshot: syntheticPatientSnapshot, diagnostics: [] }),
      },
      {
        evaluate: () => ({
          facts: syntheticClinicalFacts,
          safetySignals: syntheticSafetySignals,
        }),
        now: () => new Date("2026-08-11T03:00:00.000Z"),
      },
    );

    const response = await handler(
      { type: GET_CLINICAL_RULE_RESULTS },
      { id: extensionId, url: `chrome-extension://${extensionId}/index.html` },
    );

    expect(response).toMatchObject({
      ok: true,
      state: {
        kind: "ready",
        result: { evaluatedAt: "2026-08-11T03:00:00.000Z" },
      },
    });
    expect(JSON.stringify(response)).not.toContain(syntheticPatientSnapshot.patientId);
    expect(JSON.stringify(response)).not.toContain(syntheticPatientSnapshot.sessionId);
  });

  it("returns unavailable without calling the evaluator when no snapshot exists", async () => {
    const { createClinicalRuleMessageHandler } = await import(
      "../../src/background/clinicalRuleMessageHandler"
    );
    const evaluate = vi.fn(() => ({ facts: [], safetySignals: [] }));
    const response = await createClinicalRuleMessageHandler(
      { active: async () => undefined },
      { evaluate },
    )(
      { type: GET_CLINICAL_RULE_RESULTS },
      { id: extensionId, url: `chrome-extension://${extensionId}/index.html` },
    );

    expect(response).toEqual({ ok: true, state: { kind: "unavailable" } });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects rule access from the NHI content script", async () => {
    const { createClinicalRuleMessageHandler } = await import(
      "../../src/background/clinicalRuleMessageHandler"
    );
    const response = await createClinicalRuleMessageHandler({
      active: async () => ({ snapshot: syntheticPatientSnapshot, diagnostics: [] }),
    })(
      { type: GET_CLINICAL_RULE_RESULTS },
      { id: extensionId, url: "https://medcloud2.nhi.gov.tw/imu/example" },
    );

    expect(response).toEqual({
      ok: false,
      error: "這個頁面不能讀取臨床規則結果。",
    });
  });
});
