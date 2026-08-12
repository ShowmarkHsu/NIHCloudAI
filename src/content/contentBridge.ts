import type { PatientSnapshot } from "../domain";
import {
  type SnapshotDiagnostic,
  type ClearPatientSnapshotMessage,
  type StorePatientSnapshotMessage,
  CLEAR_PATIENT_SNAPSHOT,
  STORE_PATIENT_SNAPSHOT,
} from "../shared/patientSnapshotMessages";

/** The minimum context needed to identify an authorized source patient. */
export type PatientContext = Readonly<{
  sourcePatientKey: string;
}>;

export type SnapshotFetchResult = Readonly<{
  snapshot: PatientSnapshot;
  diagnostics: readonly SnapshotDiagnostic[];
}>;

export type NhiCloudPatientAdapter = Readonly<{
  inspectPatientContext(): PatientContext | null;
  fetchSnapshot(
    patientId: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<SnapshotFetchResult>;
}>;

export type DataSession = Readonly<{
  patientId: string;
  sessionId: string;
  signal: AbortSignal;
}>;

export type SessionEndReason =
  | "patient-switch"
  | "logout"
  | "authorization-expired"
  | "page-unload";

export type DataSessionController = Readonly<{
  activate(sourcePatientKey: string): DataSession;
  isCurrent(sessionId: string): boolean;
  end(reason: SessionEndReason): void;
}>;

export type SnapshotPublisher = Readonly<{
  store(
    snapshot: PatientSnapshot,
    diagnostics: readonly SnapshotDiagnostic[],
  ): Promise<void>;
  clear(sessionId: string, reason: SessionEndReason): Promise<void>;
}>;

export type ContentScheduler = Readonly<{
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}>;

export type ContentBridgeDependencies = Readonly<{
  adapter: NhiCloudPatientAdapter;
  session: DataSessionController;
  publisher: SnapshotPublisher;
  scheduler: ContentScheduler;
  pollIntervalMs?: number;
}>;

export type ContentBridge = Readonly<{
  start(): Promise<void>;
  refresh(): Promise<void>;
  stop(): Promise<void>;
}>;

export const DEFAULT_CONTENT_POLL_INTERVAL_MS = 1_500;

/**
 * Coordinates source-page observation, data sessions, and snapshot messages.
 *
 * This module deliberately has no browser globals.  The content entry point
 * supplies adapters for the page, session lifecycle, scheduler, and message
 * publisher; tests can replace each seam with a small fake.
 */
export function createContentBridge(
  dependencies: ContentBridgeDependencies,
): ContentBridge {
  const pollIntervalMs =
    dependencies.pollIntervalMs ?? DEFAULT_CONTENT_POLL_INTERVAL_MS;

  let started = false;
  let pollHandle: unknown;
  let activeSession: DataSession | undefined;
  let activeSourcePatientKey: string | undefined;
  let snapshotPublished = false;
  let refreshInFlight: Promise<void> | undefined;
  let refreshQueued = false;

  const isCurrent = (session: DataSession): boolean => {
    if (!started || activeSession !== session || session.signal.aborted) {
      return false;
    }

    try {
      return dependencies.session.isCurrent(session.sessionId);
    } catch {
      // A failed current-session check is treated as stale.  It is safer to
      // drop a result than to publish a snapshot into a different session.
      return false;
    }
  };

  const endActiveSession = async (
    reason: SessionEndReason,
  ): Promise<void> => {
    const session = activeSession;
    activeSession = undefined;
    activeSourcePatientKey = undefined;
    snapshotPublished = false;

    // Ending first aborts an in-flight adapter request and makes any result
    // stale before the clear message is sent.
    dependencies.session.end(reason);

    if (session) {
      await dependencies.publisher.clear(session.sessionId, reason);
    }
  };

  const captureForContext = async (
    context: PatientContext,
  ): Promise<void> => {
    const sourcePatientKey = context.sourcePatientKey.trim();
    if (sourcePatientKey.length === 0) {
      await endActiveSession("authorization-expired");
      return;
    }

    let session = activeSession;
    const sourceChanged =
      session === undefined || activeSourcePatientKey !== sourcePatientKey;

    if (sourceChanged) {
      if (session) {
        await endActiveSession("patient-switch");
      }

      session = dependencies.session.activate(sourcePatientKey);
      activeSession = session;
      activeSourcePatientKey = sourcePatientKey;
      snapshotPublished = false;
    }

    if (!session) {
      return;
    }

    if (!isCurrent(session)) {
      // A session can expire independently of the page context.  Start a new
      // session for the same source key and do not retain the old snapshot.
      await endActiveSession("authorization-expired");
      session = dependencies.session.activate(sourcePatientKey);
      activeSession = session;
      activeSourcePatientKey = sourcePatientKey;
      snapshotPublished = false;
    }

    if (!session) {
      return;
    }

    // Polls may inspect the same patient repeatedly.  Once a snapshot has
    // been published for the current session, there is no reason to refetch
    // until the source patient or session changes.
    if (snapshotPublished || !isCurrent(session)) {
      return;
    }

    let fetched: SnapshotFetchResult;
    try {
      fetched = await dependencies.adapter.fetchSnapshot(
        session.patientId,
        session.sessionId,
        session.signal,
      );
    } catch {
      // Abort/stale and adapter failures are retried by a later poll.  No
      // error is logged because the page may contain sensitive identifiers.
      return;
    }

    // The page may have switched patients while the request was in flight.
    // Check both the local reference and the session manager immediately
    // before crossing the publisher seam.
    if (!isCurrent(session)) {
      return;
    }

    try {
      await dependencies.publisher.store(fetched.snapshot, fetched.diagnostics);
      // A stop or switch can occur while sendMessage is awaiting completion;
      // only mark the session as published if it is still current.
      if (isCurrent(session)) {
        snapshotPublished = true;
      }
    } catch {
      // A failed publisher leaves the session eligible for a later retry.
    }
  };

  const performRefresh = async (): Promise<void> => {
    let context: PatientContext | null;
    try {
      context = dependencies.adapter.inspectPatientContext();
    } catch {
      context = null;
    }

    if (context === null) {
      await endActiveSession("authorization-expired");
      return;
    }

    await captureForContext(context);
  };

  const refresh = (): Promise<void> => {
    if (!started) {
      return Promise.resolve();
    }

    if (refreshInFlight) {
      // A burst of timer callbacks or explicit refresh calls shares one
      // capture.  A single follow-up observes any change that happened while
      // the request was in flight, without creating concurrent fetches.
      refreshQueued = true;
      return refreshInFlight;
    }

    const inFlight = performRefresh();
    refreshInFlight = inFlight.finally(() => {
      refreshInFlight = undefined;
      if (refreshQueued && started) {
        refreshQueued = false;
        void refresh();
      } else {
        refreshQueued = false;
      }
    });
    return refreshInFlight;
  };

  const poll = (): void => {
    void refresh();
  };

  const start = async (): Promise<void> => {
    if (started) {
      return;
    }

    started = true;
    pollHandle = dependencies.scheduler.setInterval(poll, pollIntervalMs);
    await refresh();
  };

  const stop = async (): Promise<void> => {
    if (!started && activeSession === undefined && pollHandle === undefined) {
      return;
    }

    started = false;
    refreshQueued = false;

    if (pollHandle !== undefined) {
      dependencies.scheduler.clearInterval(pollHandle);
      pollHandle = undefined;
    }

    await endActiveSession("page-unload");
  };

  return { start, refresh, stop };
}

/**
 * Runtime publisher for the browser entry point.  `runtime` is injected so
 * importing this module never requires a `chrome` global in tests.
 */
export function createRuntimeSnapshotPublisher(runtime: {
  sendMessage(
    message: StorePatientSnapshotMessage | ClearPatientSnapshotMessage,
  ): Promise<unknown> | unknown;
}): SnapshotPublisher {
  return {
    async store(snapshot, diagnostics): Promise<void> {
      await runtime.sendMessage({
        type: STORE_PATIENT_SNAPSHOT,
        snapshot,
        diagnostics,
      });
    },
    async clear(sessionId, reason): Promise<void> {
      await runtime.sendMessage({
        type: CLEAR_PATIENT_SNAPSHOT,
        sessionId,
        reason,
      });
    },
  };
}
