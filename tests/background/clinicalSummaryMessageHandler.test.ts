import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicalSummaryCoordinator } from "../../src/background/clinicalSummaryCoordinator";
import { createClinicalSummaryProvenance } from "../../src/summary";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const view = {
  generatedAt: "2026-08-11T02:00:00.000Z",
  provenance: createClinicalSummaryProvenance({
    providerId: "fake",
    model: "fake-model",
  }),
  items: [],
  sources: [],
};

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

function coordinator(): ClinicalSummaryCoordinator {
  return {
    run: vi.fn(async () => view),
    current: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
  };
}

describe("clinical summary message handler", () => {
  it("runs a valid request only from a trusted extension page", async () => {
    const { createClinicalSummaryMessageHandler } = await import(
      "../../src/background/clinicalSummaryMessageHandler"
    );
    const target = coordinator();
    const handler = createClinicalSummaryMessageHandler(target);
    const message = {
      type: "GENERATE_CLINICAL_SUMMARY",
      providerId: "ollama",
      model: "fake-model",
    } as const;

    await expect(
      handler(message, {
        id: extensionId,
        url: `chrome-extension://${extensionId}/index.html`,
      }),
    ).resolves.toEqual({ ok: true, state: { kind: "ready", summary: view } });
    expect(target.run).toHaveBeenCalledWith(message);
  });

  it("rejects generation from the NHI content script", async () => {
    const { createClinicalSummaryMessageHandler } = await import(
      "../../src/background/clinicalSummaryMessageHandler"
    );
    const target = coordinator();
    const response = await createClinicalSummaryMessageHandler(target)(
      { type: "GET_CLINICAL_SUMMARY" },
      { id: extensionId, url: "https://medcloud2.nhi.gov.tw/imu/example" },
    );

    expect(response).toMatchObject({ ok: false, errorCode: "INVALID_REQUEST" });
    expect(target.current).not.toHaveBeenCalled();
  });

  it("does not pass malformed provider requests to the coordinator", async () => {
    const { createClinicalSummaryMessageHandler } = await import(
      "../../src/background/clinicalSummaryMessageHandler"
    );
    const target = coordinator();
    const response = await createClinicalSummaryMessageHandler(target)(
      { type: "GENERATE_CLINICAL_SUMMARY", providerId: "unknown", model: "x" },
      { id: extensionId, url: `chrome-extension://${extensionId}/index.html` },
    );

    expect(response).toMatchObject({ ok: false, errorCode: "INVALID_REQUEST" });
    expect(target.run).not.toHaveBeenCalled();
  });
});
