import {
  dataSessionIdSchema,
  snapshotRevisionSchema,
} from '../contracts/patientSnapshot';
import { OLLAMA_MODEL, OPENROUTER_ENDPOINT, OPENROUTER_MODEL } from '../release/runtimeManifest';
import type { RevisionScope } from '../session/coordinator';

export const OLLAMA_GENERATE_ENDPOINT = 'http://127.0.0.1:11434/api/generate' as const;
export const OPENROUTER_GENERATE_ENDPOINT = OPENROUTER_ENDPOINT;
export const PROVIDER_TIMEOUT_MS = 180_000;

export type SummaryProvider = 'ollama' | 'openrouter';

type ProviderResponse = Readonly<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

type ProviderFetch = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  }>,
) => Promise<ProviderResponse>;

type Timer = Readonly<{
  set: (callback: () => void, delayMs: number) => unknown;
  clear: (id: unknown) => void;
}>;

export type BackgroundProviderBoundaryConfiguration = Readonly<{
  fetch: ProviderFetch;
  timeoutMs?: number;
  timer?: Timer;
}>;

export type ProviderGenerationResult =
  | Readonly<{ status: 'completed'; output: string }>
  | Readonly<{ status: 'consent-required' | 'secret-unavailable' | 'timeout' | 'cancelled' | 'failed' }>;

function assertScope(scope: RevisionScope): void {
  if (!Number.isSafeInteger(scope.tabId) || scope.tabId < 0) {
    throw new RangeError('tabId must be a non-negative safe integer');
  }
  if (!dataSessionIdSchema.safeParse(scope.sessionId).success) {
    throw new RangeError('sessionId must be a valid opaque data session id');
  }
  if (!snapshotRevisionSchema.safeParse(scope.revision).success) {
    throw new RangeError('revision must be a positive safe integer');
  }
}

function scopeKey(scope: RevisionScope): string {
  return JSON.stringify([scope.tabId, scope.sessionId, scope.revision]);
}

function defaultTimer(): Timer {
  return {
    set(callback, delayMs) {
      return globalThis.setTimeout(callback, delayMs);
    },
    clear(id) {
      globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>);
    },
  };
}

function fixedRequest(provider: SummaryProvider, secret: string | undefined): {
  endpoint: string;
  headers: Record<string, string>;
  body: string;
} {
  if (provider === 'ollama') {
    return {
      endpoint: OLLAMA_GENERATE_ENDPOINT,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: 'Return only the fixed clinical-summary.v1 JSON.', stream: false }),
    };
  }
  if (secret === undefined) throw new TypeError('OpenRouter requires a session secret');
  return {
    endpoint: OPENROUTER_GENERATE_ENDPOINT,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: 'Return only the fixed clinical-summary.v1 JSON.' }],
      stream: false,
      temperature: 0,
      top_p: 1,
      seed: 0,
    }),
  };
}

function outputFromResponse(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const output = Reflect.get(value, 'completion');
  return typeof output === 'string' && output.length > 0 ? output : null;
}

/**
 * The only Provider execution boundary. Its BYOK vault is an unexported
 * in-memory Map keyed by opaque data-session id; it is neither persisted nor
 * reachable from content code. Requests cannot choose a URL, model, method,
 * or prompt, and never receive a patient record through this API.
 */
export function createBackgroundProviderBoundary(
  configuration: BackgroundProviderBoundaryConfiguration,
) {
  const timeoutMs = configuration.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive safe integer');
  }
  const timer = configuration.timer ?? defaultTimer();
  const openRouterSecretsBySession = new Map<string, string>();
  const remoteConsentBySession = new Set<string>();
  const pendingByScope = new Map<string, AbortController>();

  function clearSession(scope: RevisionScope): boolean {
    const pending = pendingByScope.get(scopeKey(scope));
    const hadSecret = openRouterSecretsBySession.delete(scope.sessionId);
    const hadConsent = remoteConsentBySession.delete(scope.sessionId);
    if (pending !== undefined) {
      pending.abort();
      pendingByScope.delete(scopeKey(scope));
    }
    return pending !== undefined || hadSecret || hadConsent;
  }

  return Object.freeze({
    storeOpenRouterSessionSecret(scope: RevisionScope, secret: string): void {
      assertScope(scope);
      if (secret.length < 1 || secret.length > 4_096) {
        throw new RangeError('session secret must be a non-empty bounded value');
      }
      openRouterSecretsBySession.set(scope.sessionId, secret);
    },

    grantRemoteConsent(scope: RevisionScope): void {
      assertScope(scope);
      remoteConsentBySession.add(scope.sessionId);
    },

    cancel(scope: RevisionScope): boolean {
      assertScope(scope);
      return clearSession(scope);
    },

    async generate(scope: RevisionScope, provider: SummaryProvider): Promise<ProviderGenerationResult> {
      assertScope(scope);
      if (provider === 'openrouter') {
        if (!openRouterSecretsBySession.has(scope.sessionId)) return { status: 'secret-unavailable' };
        if (!remoteConsentBySession.has(scope.sessionId)) return { status: 'consent-required' };
      }

      const controller = new AbortController();
      const key = scopeKey(scope);
      pendingByScope.set(key, controller);
      let timedOut = false;
      const request = fixedRequest(provider, openRouterSecretsBySession.get(scope.sessionId));
      const fetchPromise = configuration.fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const timeout = timer.set(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetchPromise;
        if (!response.ok) return { status: 'failed' };
        const output = outputFromResponse(await response.json());
        return output === null ? { status: 'failed' } : { status: 'completed', output };
      } catch {
        return timedOut ? { status: 'timeout' } : { status: 'cancelled' };
      } finally {
        timer.clear(timeout);
        pendingByScope.delete(key);
      }
    },
  });
}
