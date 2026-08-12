/**
 * The small interface at the data-session seam.  A session contains only
 * opaque identifiers and cancellation state; the source-system patient key
 * remains an implementation detail of the in-memory manager.
 */
export type DataSession = Readonly<{
  patientId: string;
  sessionId: string;
  signal: AbortSignal;
  startedAt: string;
}>;

/** Reasons understood by the extension's session lifecycle. */
export type DataSessionEndReason =
  | "patient-switch"
  | "logout"
  | "authorization-expired"
  | "page-unload"
  | "manual";

export type DataSessionOptions = Readonly<{
  /** Injectable opaque-id source; defaults to a cryptographically random UUID. */
  idFactory?: () => string;
  /** Injectable clock; its value is serialized as an ISO timestamp. */
  now?: () => Date;
}>;

export interface DataSessionManager {
  /**
   * Activate the source patient represented by `sourcePatientKey`.
   *
   * Repeated activation of the same source key returns the existing session.
   * A different key aborts the existing session before creating a new one.
   * The key is retained only inside this manager's closure and is never part
   * of a returned value.
   */
  activate(sourcePatientKey: string): DataSession;

  /** Abort and clear the active session, if one exists. */
  end(reason: DataSessionEndReason): void;

  /** Return true when a session ID still belongs to the active session. */
  isCurrent(sessionId: string): boolean;
}

function randomOpaqueId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  // randomUUID is unavailable in a few older extension contexts.  Use the
  // Web Crypto byte source as a standards-compliant fallback rather than a
  // predictable Math.random-based identifier.
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("A cryptographically secure random source is required.");
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  // RFC 4122 version 4 and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function assertOpaqueId(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} factory must return a non-empty string.`);
  }
  return value;
}

function toStartedAt(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Session clock must return a valid Date.");
  }
  return value.toISOString();
}

/**
 * Create the in-process data-session manager.
 *
 * Nothing is persisted or logged.  In particular, `sourcePatientKey` is
 * retained solely for exact-equality switch detection in the closure.
 */
export function createDataSession(
  options: DataSessionOptions = {},
): DataSessionManager {
  const idFactory = options.idFactory ?? randomOpaqueId;
  const now = options.now ?? (() => new Date());
  let active:
    | Readonly<{
        sourcePatientKey: string;
        controller: AbortController;
        session: DataSession;
      }>
    | undefined;

  const activate = (sourcePatientKey: string): DataSession => {
    if (active?.sourcePatientKey === sourcePatientKey) {
      return active.session;
    }

    if (active) {
      active.controller.abort("patient-switch");
      // Clear before invoking injected factories so a factory failure cannot
      // leave an aborted session looking reusable for the old source key.
      active = undefined;
    }

    const controller = new AbortController();
    const session: DataSession = Object.freeze({
      patientId: assertOpaqueId(idFactory(), "patientId"),
      sessionId: assertOpaqueId(idFactory(), "sessionId"),
      signal: controller.signal,
      startedAt: toStartedAt(now),
    });
    // Keep the controller paired with the signal without exposing it through
    // the public session object.
    active = { sourcePatientKey, controller, session };
    return session;
  };

  const end = (reason: DataSessionEndReason): void => {
    if (!active) {
      return;
    }
    active.controller.abort(reason);
    active = undefined;
  };

  const isCurrent = (sessionId: string): boolean => {
    return active !== undefined && active.session.sessionId === sessionId;
  };

  return { activate, end, isCurrent };
}
