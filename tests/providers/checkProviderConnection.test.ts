import { describe, expect, it, vi } from "vitest";
import {
  checkProviderConnection,
  PROVIDER_CONNECTION_CHECK_SCHEMA,
} from "../../src/providers/checkProviderConnection";
import type { SummaryProvider } from "../../src/providers";
import {
  SYNTHETIC_PATIENT_ID,
  SYNTHETIC_SESSION_ID,
  syntheticPatientSnapshot,
} from "../../src/domain";

function createProvider(output: unknown): SummaryProvider {
  return {
    id: "synthetic-health-provider",
    generateSummary: vi.fn(async () => ({
      providerId: "synthetic-health-provider",
      model: "synthetic-health-model",
      output,
    })),
  };
}

describe("checkProviderConnection", () => {
  it("returns provider metadata after a strict ok response", async () => {
    const provider = createProvider({ status: "ok" });

    await expect(checkProviderConnection(provider)).resolves.toEqual({
      providerId: "synthetic-health-provider",
      model: "synthetic-health-model",
    });

    const request = vi.mocked(provider.generateSummary).mock.calls[0][0];
    expect(request.outputSchema).toEqual(PROVIDER_CONNECTION_CHECK_SCHEMA);
    expect(request.outputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: { status: { type: "string", enum: ["ok"] } },
    });
  });

  it("rejects output with echoed text or any extra field", async () => {
    for (const output of [
      { status: "ok", text: "unexpected model response" },
      { status: "ready" },
      { status: "ok", patientId: SYNTHETIC_PATIENT_ID },
    ]) {
      await expect(checkProviderConnection(createProvider(output))).rejects.toThrow();
    }
  });

  it("passes cancellation through without changing the fixed request", async () => {
    const provider = createProvider({ status: "ok" });
    const controller = new AbortController();

    await checkProviderConnection(provider, controller.signal);

    const request = vi.mocked(provider.generateSummary).mock.calls[0][0];
    expect(request.signal).toBe(controller.signal);
  });

  it("does not put synthetic patient/session/record data in the request", async () => {
    const provider = createProvider({ status: "ok" });

    await checkProviderConnection(provider);

    const request = vi.mocked(provider.generateSummary).mock.calls[0][0];
    const prompt = request.messages.map((message) => message.content).join("\n");
    const recordSummaries = syntheticPatientSnapshot.records.map(
      (record) => record.summary,
    );

    expect(prompt).not.toContain(SYNTHETIC_PATIENT_ID);
    expect(prompt).not.toContain(SYNTHETIC_SESSION_ID);
    for (const summary of recordSummaries) {
      expect(prompt).not.toContain(summary);
    }
  });
});
