import { describe, expect, it } from "vitest";
import {
  syntheticPatientSnapshot,
  SYNTHETIC_SESSION_ID,
} from "../../src/domain";
import {
  createPatientSnapshotStore,
  type SnapshotSessionStoragePort,
} from "../../src/background/patientSnapshotStore";

function createMemoryStorage(): SnapshotSessionStoragePort {
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
  } as SnapshotSessionStoragePort;
}

describe("patient snapshot session store", () => {
  it("stores only a status projection for callers", async () => {
    const store = createPatientSnapshotStore(createMemoryStorage());
    const status = await store.save(syntheticPatientSnapshot, [
      { source: "lab", level: "warning", message: "Synthetic warning." },
    ]);

    expect(status).toMatchObject({
      available: true,
      sessionId: SYNTHETIC_SESSION_ID,
      warningCount: 1,
    });
    expect(status).not.toHaveProperty("patientId");
    expect(status).not.toHaveProperty("snapshot");
    await expect(store.active()).resolves.toMatchObject({
      snapshot: syntheticPatientSnapshot,
    });
  });

  it("ignores a stale clear from a previous patient session", async () => {
    const store = createPatientSnapshotStore(createMemoryStorage());
    await store.save(syntheticPatientSnapshot, []);

    const status = await store.clear("stale-session");

    expect(status.available).toBe(true);
    expect(status.sessionId).toBe(SYNTHETIC_SESSION_ID);
  });

  it("clears the matching active session", async () => {
    const store = createPatientSnapshotStore(createMemoryStorage());
    await store.save(syntheticPatientSnapshot, []);

    await expect(store.clear(SYNTHETIC_SESSION_ID)).resolves.toEqual({
      available: false,
    });
  });
});
