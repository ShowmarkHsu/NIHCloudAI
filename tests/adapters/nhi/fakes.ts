import type {
  NhiCloudAdapter,
  NhiFetch,
  NhiPatientContext,
  NhiSessionStorage,
  NhiSnapshotResult,
} from "../../../src/adapters/nhi";

export function createFakeSessionStorage(
  entries: Record<string, string> = {},
): NhiSessionStorage {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
  };
}

export function createSyntheticJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8")
      .toString("base64url")
      .replace(/=+$/g, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.synthetic-signature`;
}

export function createFakeFetch(
  responses: Record<string, unknown | Error>,
): NhiFetch {
  return async (input) => {
    const url = String(input);
    const response = Object.entries(responses).find(([path]) => url.includes(path))?.[1];
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response ?? { rObject: [] }), { status: 200 });
  };
}

/** A deterministic adapter fake for callers that only need the public seam. */
export function createFakeNhiCloudAdapter(options: {
  context?: NhiPatientContext | null;
  result?: NhiSnapshotResult;
} = {}): NhiCloudAdapter {
  const context = options.context ?? null;
  const result = options.result ?? {
    snapshot: {
      patientId: "synthetic-patient",
      sessionId: "synthetic-session",
      capturedAt: "2026-08-11T00:00:00.000Z",
      records: [],
    },
    diagnostics: [],
  };
  return {
    inspectPatientContext: () => context,
    fetchSnapshot: async () => result,
  };
}
