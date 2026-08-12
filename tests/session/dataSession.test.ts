import { describe, expect, it } from "vitest";
import { createDataSession } from "../../src/session";

function createDeterministicManager() {
  const ids = ["patient-1", "session-1", "patient-2", "session-2"];
  const times = [
    new Date("2026-08-11T00:00:00.000Z"),
    new Date("2026-08-11T00:01:00.000Z"),
  ];
  return createDataSession({
    idFactory: () => ids.shift() ?? "unexpected-id",
    now: () => times.shift() ?? new Date("2026-08-11T00:02:00.000Z"),
  });
}

describe("data session", () => {
  it("reuses a session for the same source patient key", () => {
    const manager = createDeterministicManager();

    const first = manager.activate("source-a");
    const again = manager.activate("source-a");

    expect(again).toBe(first);
    expect(first).toMatchObject({
      patientId: "patient-1",
      sessionId: "session-1",
      startedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(first.signal.aborted).toBe(false);
    expect(manager.isCurrent(first.sessionId)).toBe(true);
  });

  it("aborts the old session and creates opaque identities on a patient switch", () => {
    const manager = createDeterministicManager();
    const first = manager.activate("source-a");

    const second = manager.activate("source-b");

    expect(first.signal.aborted).toBe(true);
    expect(second).toMatchObject({
      patientId: "patient-2",
      sessionId: "session-2",
      startedAt: "2026-08-11T00:01:00.000Z",
    });
    expect(second.patientId).not.toBe("source-b");
    expect(second.sessionId).not.toBe("source-b");
    expect(manager.isCurrent(first.sessionId)).toBe(false);
    expect(manager.isCurrent(second.sessionId)).toBe(true);
  });

  it("aborts and clears the session on logout/end", () => {
    const manager = createDeterministicManager();
    const session = manager.activate("source-a");

    manager.end("logout");

    expect(session.signal.aborted).toBe(true);
    expect((session.signal as AbortSignal & { reason?: unknown }).reason).toBe(
      "logout",
    );
    expect(manager.isCurrent(session.sessionId)).toBe(false);
  });

  it("rejects stale session tokens without needing the source patient key", () => {
    const manager = createDeterministicManager();
    const first = manager.activate("source-a");
    manager.activate("source-b");

    expect(manager.isCurrent(first.sessionId)).toBe(false);
  });
});
