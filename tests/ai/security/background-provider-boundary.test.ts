import { describe, expect, it, vi } from 'vitest';

import {
  OLLAMA_GENERATE_ENDPOINT,
  OPENROUTER_GENERATE_ENDPOINT,
  createBackgroundProviderBoundary,
} from '../../../src/ai/providers/backgroundProviderBoundary';
import { createSealedSummaryRequest } from '../../../src/ai/summary/providerRequest';
import { createLabVerticalSlice } from '../../../src/ai/integration/labVerticalSlice';

const scope = {
  tabId: 17,
  sessionId: 'ds_provider_session_0001',
  revision: 1,
} as const;

function providerOutput() {
  return JSON.stringify({
    schemaVersion: 'clinical-summary.v1',
    timeWindows: {
      medicationsAndAllergies: 'current-available-data', recentCourseAndTests: 'past-90-days',
      admissionsProceduresAndDischarge: 'past-1-year',
    },
    sections: [
      {heading: '核對重點', content: '重'.repeat(40), sourceAliases: ['S1']},
      {heading: '目前用藥與過敏', content: '要'.repeat(40), sourceAliases: ['S1']},
      {heading: '近期病程與檢查', content: '點'.repeat(40), sourceAliases: ['S1']},
      {heading: '住院、手術與出院', content: '資'.repeat(40), sourceAliases: []},
      {heading: '資料缺口與待確認', content: `資料缺口：${'待'.repeat(40)}；待確認：${'核'.repeat(40)}`, sourceAliases: []},
    ],
  });
}

function request(revision: number = scope.revision) {
  const vertical = createLabVerticalSlice({
    now: () => '2026-08-21T00:00:00.000Z',
    issueSourceReference: () => 'sr_provider_test_source_00001',
  });
  const sealed = vertical.ingest({
    patientId: 'pt_provider_patient_00001', sessionId: scope.sessionId, revision,
  }, {
    status: 'success', dataType: 'labdata', recordCount: 1,
    data: {rObject: [{
      hosp: 'Synthetic Lab;outpatient;0000000000', real_inspect_date: '2026/08/20',
      order_code: 'LAB-001', assay_item_name: 'Synthetic analyte', assay_value: '1.0',
      unit_data: 'mg/dL', consult_value: '0-2', assay_mark: '0',
    }]},
  })?.sealed;
  return createSealedSummaryRequest({
    tabId: scope.tabId, patientId: 'pt_provider_patient_00001', sessionId: scope.sessionId,
    revision, contractVersion: 'clinical-projection.v1',
  }, sealed);
}

type Request = { url: string; init: { body: string; signal: AbortSignal } };

function successfulFetch() {
  const requests: Request[] = [];
  const fetch = vi.fn(async (url: string, init: Request['init']) => {
    requests.push({ url, init });
    return {
    ok: true,
    status: 200,
    json: async () => ({ response: providerOutput() }),
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
    await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toMatchObject({
      status: 'completed', summary: {sections: expect.any(Array)},
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

    await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toEqual({
      status: 'consent-required',
    });
    expect(fetch).not.toHaveBeenCalled();

    provider.grantRemoteConsent(scope);
    expect(provider.cancel(scope)).toBe(true);
    await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toEqual({
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

    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toEqual({ status: 'timeout' });
    expect(requests[0]?.url).toBe(OLLAMA_GENERATE_ENDPOINT);
    expect(requests[0]?.init.body).not.toContain('patientId');
  });

  it('does not label a non-abort Provider failure as a user cancellation', async () => {
    const fetch = vi.fn(async () => Promise.reject(new Error('synthetic network failure')));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});

    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toEqual({status: 'failed'});
  });

  it('fails closed instead of replacing an in-flight request for the same scope', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn((_url: string, init: Request['init']) => new Promise<never>((_, reject) => {
      requests.push({url: _url, init});
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});

    const first = provider.generate(scope, 'ollama', request()!);
    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toEqual({status: 'failed'});
    expect(requests).toHaveLength(1);

    expect(provider.cancel(scope)).toBe(true);
    await expect(first).resolves.toEqual({status: 'cancelled'});
  });

  it('requires the optional OpenRouter host grant and pins the route without widening a request', async () => {
    const { fetch, requests } = successfulFetch();
    const ensureOptionalHostPermission = vi.fn(async () => false);
    const provider = createBackgroundProviderBoundary({
      fetch: fetch as never,
      ensureOptionalHostPermission,
    });
    provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');
    provider.grantRemoteConsent(scope);

    await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toEqual({status: 'permission-required'});
    expect(ensureOptionalHostPermission).toHaveBeenCalledWith('openrouter');
    expect(fetch).not.toHaveBeenCalled();

    ensureOptionalHostPermission.mockResolvedValueOnce(true);
    await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toMatchObject({status: 'completed'});
    const sent = JSON.parse(requests[0]!.init.body);
    expect(sent.provider).toEqual({
      order: ['deepinfra'], allow_fallbacks: false, require_parameters: true,
      data_collection: 'deny', zdr: true,
    });
    expect(sent).not.toHaveProperty('route');
    expect(sent.messages[0].content).not.toContain('pt_provider_patient_00001');
  });

  it('does not let an old revision cancel the current revision secret or consent', async () => {
    const { fetch } = successfulFetch();
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});
    const current = {...scope, revision: 2};
    provider.storeOpenRouterSessionSecret(scope, 'old-secret');
    provider.grantRemoteConsent(scope);
    provider.storeOpenRouterSessionSecret(current, 'current-secret');
    provider.grantRemoteConsent(current);

    expect(provider.cancel(scope)).toBe(true);
    await expect(provider.generate(current, 'openrouter', request(2)!)).resolves.toMatchObject({status: 'completed'});
    expect(fetch).toHaveBeenCalledOnce();
  });
});
