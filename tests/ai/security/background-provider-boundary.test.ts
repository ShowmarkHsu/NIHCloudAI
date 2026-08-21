import { describe, expect, it, vi } from 'vitest';

import {
  OLLAMA_GENERATE_ENDPOINT,
  OPENROUTER_GENERATE_ENDPOINT,
  createBackgroundProviderBoundary,
} from '../../../src/ai/providers/backgroundProviderBoundary';

const scope = {
  tabId: 17,
  sessionId: 'ds_provider_session_0001',
  revision: 1,
} as const;

type Request = { url: string; init: { body: string; signal: AbortSignal } };

function successfulFetch() {
  const requests: Request[] = [];
  const fetch = vi.fn(async (url: string, init: Request['init']) => {
    requests.push({ url, init });
    return {
    ok: true,
    status: 200,
    json: async () => ({ completion: 'synthetic-provider-output' }),
    };
  });
  return { fetch, requests };
}

describe('background-only Provider boundary', () => {
  it('uses only fixed Provider endpoint/model configuration and keeps the BYOK value session-only', async () => {
    const { fetch, requests } = successfulFetch();
    const provider = createBackgroundProviderBoundary({ fetch: fetch as never });

    provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');
    provider.grantRemoteConsent(scope);
    await expect(provider.generate(scope, 'openrouter')).resolves.toEqual({
      status: 'completed', output: 'synthetic-provider-output',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(OPENROUTER_GENERATE_ENDPOINT);
    expect(requests[0]?.init.body).toContain('openai/gpt-oss-120b');
    expect(requests[0]?.init.body).not.toContain('patientId');
    expect(Object.keys(provider)).not.toContain('readOpenRouterSessionSecret');
    expect(Object.keys(provider)).not.toContain('fetch');
  });

  it('does not perform a remote request before explicit consent and clears a cancelled session', async () => {
    const { fetch } = successfulFetch();
    const provider = createBackgroundProviderBoundary({ fetch: fetch as never });
    provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');

    await expect(provider.generate(scope, 'openrouter')).resolves.toEqual({
      status: 'consent-required',
    });
    expect(fetch).not.toHaveBeenCalled();

    provider.grantRemoteConsent(scope);
    expect(provider.cancel(scope)).toBe(true);
    await expect(provider.generate(scope, 'openrouter')).resolves.toEqual({
      status: 'secret-unavailable',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels timed-out fixed local requests without a clinical-record network fixture', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn((_url: string, init: Request['init']) => new Promise<never>((_, reject) => {
      requests.push({ url: _url, init });
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const provider = createBackgroundProviderBoundary({
      fetch: fetch as never,
      timeoutMs: 1,
      timer: { set(callback) { callback(); return 1; }, clear() {} },
    });

    await expect(provider.generate(scope, 'ollama')).resolves.toEqual({ status: 'timeout' });
    expect(requests[0]?.url).toBe(OLLAMA_GENERATE_ENDPOINT);
    expect(requests[0]?.init.body).not.toContain('records');
  });
});
