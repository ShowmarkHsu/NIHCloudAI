import {
  dataSessionIdSchema,
  snapshotRevisionSchema,
} from '../contracts/patientSnapshot';
import { OLLAMA_MODEL, OPENROUTER_ENDPOINT, OPENROUTER_MODEL, OPENROUTER_ROUTE } from '../release/runtimeManifest';
import type { RevisionScope } from '../session/coordinator';
import {
  FIXED_FIVE_SECTION_PROVIDER_JSON_SCHEMA,
  parseProviderSummaryOutput,
  isSealedSummaryRequest,
  type SealedSummaryRequest,
} from '../summary/providerRequest';
import type { FixedFiveSectionSummary } from '../contracts/summary';

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
  ensureOptionalHostPermission?: (provider: SummaryProvider) => Promise<boolean>;
}>;

export type ProviderGenerationResult =
  | Readonly<{ status: 'completed'; summary: FixedFiveSectionSummary }>
  | Readonly<{ status: 'permission-required' | 'consent-required' | 'secret-unavailable' | 'timeout' | 'cancelled' | 'failed' | 'transport-failed' | 'response-unreadable' | 'provider-http-failed' | 'validation-failed' }>;

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

function fixedRequest(provider: SummaryProvider, secret: string | undefined, request: SealedSummaryRequest): {
  endpoint: string;
  headers: Record<string, string>;
  body: string;
} {
  if (provider === 'ollama') {
    return {
      endpoint: OLLAMA_GENERATE_ENDPOINT,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: request.prompt, stream: false }),
    };
  }
  if (secret === undefined) throw new TypeError('OpenRouter requires a session secret');
  return {
    endpoint: OPENROUTER_GENERATE_ENDPOINT,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: request.prompt }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'fixed_five_section_clinical_summary',
          strict: true,
          schema: FIXED_FIVE_SECTION_PROVIDER_JSON_SCHEMA,
        },
      },
      stream: false,
      temperature: 0,
      top_p: 1,
      seed: 0,
      provider: {
        order: [OPENROUTER_ROUTE.split('/')[0]],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: 'deny',
        zdr: true,
      },
    }),
  };
}

function outputFromResponse(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const ollamaOutput = Reflect.get(value, 'response');
  if (typeof ollamaOutput === 'string' && ollamaOutput.length > 0) return ollamaOutput;
  const completion = Reflect.get(value, 'completion');
  if (typeof completion === 'string' && completion.length > 0) return completion;
  const choices = Reflect.get(value, 'choices');
  if (!Array.isArray(choices) || choices.length !== 1 || typeof choices[0] !== 'object' || choices[0] === null) return null;
  const message = Reflect.get(choices[0], 'message');
  const output = typeof message === 'object' && message !== null ? Reflect.get(message, 'content') : null;
  return typeof output === 'string' && output.length > 0 ? output : null;
}

/**
 * The only Provider execution boundary. Its BYOK vault is an unexported
 * in-memory Map keyed by an opaque tab/session/revision scope; it is neither persisted nor
 * reachable from content code. Requests cannot choose a URL, model, method,
 * or prompt. It receives only a parsed SealedSummaryRequest, never a DOM node,
 * raw API payload, endpoint, model, header, or free-form request object.
 */
export function createBackgroundProviderBoundary(
  configuration: BackgroundProviderBoundaryConfiguration,
) {
  const timeoutMs = configuration.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive safe integer');
  }
  const timer = configuration.timer ?? defaultTimer();
  const openRouterSecretsByScope = new Map<string, string>();
  const remoteConsentByScope = new Set<string>();
  const pendingByScope = new Map<string, AbortController>();

  function clearSession(scope: RevisionScope): boolean {
    const pending = pendingByScope.get(scopeKey(scope));
    const key = scopeKey(scope);
    const hadSecret = openRouterSecretsByScope.delete(key);
    const hadConsent = remoteConsentByScope.delete(key);
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
      openRouterSecretsByScope.set(scopeKey(scope), secret);
    },

    grantRemoteConsent(scope: RevisionScope): void {
      assertScope(scope);
      remoteConsentByScope.add(scopeKey(scope));
    },

    cancel(scope: RevisionScope): boolean {
      assertScope(scope);
      return clearSession(scope);
    },

    async generate(scope: RevisionScope, provider: SummaryProvider, request: SealedSummaryRequest): Promise<ProviderGenerationResult> {
      assertScope(scope);
      if (
        !isSealedSummaryRequest(request) ||
        request.scope.tabId !== scope.tabId ||
        request.scope.sessionId !== scope.sessionId ||
        request.scope.revision !== scope.revision ||
        request.prompt.length === 0 || request.prompt.length > 200_000
      ) return {status: 'failed'};
      if (configuration.ensureOptionalHostPermission !== undefined && !(await configuration.ensureOptionalHostPermission(provider))) {
        return {status: 'permission-required'};
      }
      if (provider === 'openrouter') {
        if (!openRouterSecretsByScope.has(scopeKey(scope))) return { status: 'secret-unavailable' };
        if (!remoteConsentByScope.has(scopeKey(scope))) return { status: 'consent-required' };
      }

      const key = scopeKey(scope);
      if (pendingByScope.has(key)) return {status: 'failed'};
      const controller = new AbortController();
      pendingByScope.set(key, controller);
      let timedOut = false;
      const fixed = fixedRequest(provider, openRouterSecretsByScope.get(scopeKey(scope)), request);
      let fetchPromise: Promise<ProviderResponse>;
      try {
        fetchPromise = configuration.fetch(fixed.endpoint, {
          method: 'POST',
          headers: fixed.headers,
          body: fixed.body,
          signal: controller.signal,
        });
      } catch {
        pendingByScope.delete(key);
        return {status: 'transport-failed'};
      }
      const timeout = timer.set(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        let response: ProviderResponse;
        try {
          response = await fetchPromise;
        } catch {
          if (timedOut) return {status: 'timeout'};
          return controller.signal.aborted ? {status: 'cancelled'} : {status: 'transport-failed'};
        }
        if (!response.ok) return {status: 'provider-http-failed'};
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return {status: 'response-unreadable'};
        }
        const output = outputFromResponse(payload);
        const summary = output === null ? null : parseProviderSummaryOutput(output, request);
        return summary === null ? {status: 'validation-failed'} : {status: 'completed', summary};
      } catch {
        return {status: 'response-unreadable'};
      } finally {
        timer.clear(timeout);
        pendingByScope.delete(key);
      }
    },
  });
}
