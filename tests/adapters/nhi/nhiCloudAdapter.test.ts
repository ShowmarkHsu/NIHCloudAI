import { describe, expect, it, vi } from "vitest";
import {
  NhiAdapterError,
  NhiCloudAdapterImpl,
} from "../../../src/adapters/nhi";
import {
  createFakeSessionStorage,
  createSyntheticJwt,
} from "./fakes";

const NOW = new Date("2026-08-11T01:00:00.000Z");

function tokenWith(
  payload: Record<string, unknown> = {
    exp: Math.floor(NOW.getTime() / 1000) + 600,
    patientId: "synthetic-source-patient",
    permissions: ["2.1", "5.1", "6.1", "6.2", "8.1"],
  },
): string {
  return createSyntheticJwt(payload);
}

function createAdapter(
  fetch: typeof globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ rObject: [] }), { status: 200 }),
  ),
  token = tokenWith(),
) {
  return new NhiCloudAdapterImpl({
    fetch,
    sessionStorage: createFakeSessionStorage({ auth: token }),
    now: () => NOW,
  });
}

describe("NhiCloudAdapter", () => {
  it("returns a redacted short-lived context and never the JWT", () => {
    const token = tokenWith();
    const context = createAdapter(undefined, token).inspectPatientContext();

    expect(context).toEqual({
      sourcePatientKey: "synthetic-source-patient",
      permissionNodes: ["2.1", "5.1", "6.1", "6.2", "8.1"],
      expiry: "2026-08-11T01:10:00.000Z",
    });
    expect(JSON.stringify(context)).not.toContain(token);
  });

  it("understands the page bridge's capitalized UserID and Permission claims", () => {
    const context = createAdapter(undefined, tokenWith({
      exp: Math.floor(NOW.getTime() / 1000) + 600,
      UserID: "synthetic-user-id",
      Permission: ["2.1", "6.1"],
    })).inspectPatientContext();

    expect(context).toEqual({
      sourcePatientKey: "synthetic-user-id",
      permissionNodes: ["2.1", "6.1"],
      expiry: "2026-08-11T01:10:00.000Z",
    });
  });

  it.each([
    ["missing token", undefined],
    ["malformed token", "not-a-jwt"],
    ["expired token", tokenWith({ exp: Math.floor(NOW.getTime() / 1000) - 1, sub: "synthetic" })],
  ])("returns null for %s", (_label, token) => {
    const adapter = new NhiCloudAdapterImpl({
      fetch: vi.fn(),
      sessionStorage: createFakeSessionStorage(token ? { token } : {}),
      now: () => NOW,
    });
    expect(adapter.inspectPatientContext()).toBeNull();
  });

  it("calls only authorized allow-listed endpoints and passes signal/auth in fetch", async () => {
    const controller = new AbortController();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ rObject: [] }), { status: 200 });
    });
    const adapter = createAdapter(fetch, tokenWith({
      exp: Math.floor(NOW.getTime() / 1000) + 600,
      sub: "synthetic-source-patient",
      permissions: ["2.1", "6.2"],
    }));

    const result = await adapter.fetchSnapshot("opaque-patient", "opaque-session", controller.signal);

    expect(calls).toHaveLength(2);
    expect(String(calls[0].input)).toContain("/imu/api/imue0008/imue0008s02/get-data");
    expect(String(calls[1].input)).toContain("/imu/api/imue0130/imue0130s02/get-data");
    for (const call of calls) {
      expect(call.init).toMatchObject({
        method: "GET",
        credentials: "include",
        signal: controller.signal,
        headers: { Authorization: expect.stringMatching(/^Bearer /) },
      });
      expect(call.init?.headers).toMatchObject({
        Accept: "application/json,text/plain,*/*",
        "X-Requested-With": "XMLHttpRequest",
      });
      expect(String(call.init?.headers)).not.toContain("opaque-patient");
    }
    expect(String(calls[0].input)).toContain("cli_datetime=2026-08-11T01%3A00%3A00");
    expect(String(calls[0].input)).toContain("insert_log=true");
    expect(result.snapshot.records).toEqual([]);
    expect(result.diagnostics).toHaveLength(5);
  });

  it("normalizes rObject records, strips direct identifiers, and keeps partial failures", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("imue0008")) {
        return new Response(JSON.stringify({
          rObject: [{
            patient_id: "real-patient-must-not-leak",
            drug_date: "20260810",
            drug_ename: "Synthetic medicine",
            drug_ing_name: "Synthetic generic",
            drug_code: "SYN-001",
            dosage: "10 mg",
            frequency: "daily",
            hosp: "Synthetic Hospital",
          }],
        }), { status: 200 });
      }
      if (url.includes("imue0040")) return new Response("upstream unavailable", { status: 503 });
      return new Response(JSON.stringify({ robject: [] }), { status: 200 });
    });
    const adapter = createAdapter(fetch);
    const result = await adapter.fetchSnapshot("opaque-patient", "opaque-session");
    const record = result.snapshot.records[0];

    expect(record).toMatchObject({
      id: "nhi-opaque-session-medication-1",
      patientId: "opaque-patient",
      sessionId: "opaque-session",
      type: "medication",
      recordedAt: "2026-08-10T00:00:00.000Z",
      data: {
        medicationName: "Synthetic medicine",
        genericName: "Synthetic generic",
        code: "SYN-001",
      },
    });
    expect(record.data).not.toHaveProperty("patient_id");
    expect(JSON.stringify(result)).not.toContain("real-patient-must-not-leak");
    expect(result.diagnostics).toContainEqual({
      source: "allergy",
      level: "warning",
      message: "NHI allergy subset request failed with HTTP 503.",
    });
  });

  it("rejects malformed authorization when fetching", async () => {
    const adapter = createAdapter(undefined, "malformed");
    await expect(adapter.fetchSnapshot("opaque-patient", "opaque-session")).rejects.toMatchObject<
      NhiAdapterError
    >({ code: "malformed-token" });
  });

  it("does not swallow AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    });
    const adapter = createAdapter(fetch);
    await expect(adapter.fetchSnapshot("opaque-patient", "opaque-session", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
