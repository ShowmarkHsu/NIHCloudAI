import { describe, expect, it, vi } from 'vitest';

import {
  OLLAMA_GENERATE_ENDPOINT,
  OPENROUTER_GENERATE_ENDPOINT,
  createBackgroundProviderBoundary,
} from '../../../src/ai/providers/backgroundProviderBoundary';
import {
  FIXED_FIVE_SECTION_PROVIDER_JSON_SCHEMA,
  createSealedSummaryRequest,
} from '../../../src/ai/summary/providerRequest';
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

function emptyRequest() {
  const vertical = createLabVerticalSlice({
    now: () => '2026-08-21T00:00:00.000Z',
    issueSourceReference: () => 'sr_provider_unused_source_0001',
  });
  const sealed = vertical.ingest({
    patientId: 'pt_provider_patient_00001', sessionId: scope.sessionId, revision: scope.revision,
  }, {
    status: 'nodata', dataType: 'labdata', recordCount: 0,
  })?.sealed;
  return createSealedSummaryRequest({
    tabId: scope.tabId, patientId: 'pt_provider_patient_00001', sessionId: scope.sessionId,
    revision: scope.revision, contractVersion: 'clinical-projection.v1',
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

  it('reports a transport failure without exposing its browser error', async () => {
    const fetch = vi.fn(async () => Promise.reject(new Error('synthetic network failure')));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});

    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toEqual({status: 'transport-failed'});
  });

  it('reports an unreadable provider response without exposing its contents', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => Promise.reject(new Error('synthetic unreadable response')),
    }));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});

    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toEqual({status: 'response-unreadable'});
  });

  it('classifies an invalid provider document without exposing its contents', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({response: '{"sections":[]}'}),
    }));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});

    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toEqual({status: 'validation-structure-failed'});
  });

  it('classifies local alias, content-policy, and character-count failures without returning output', async () => {
    const cases = [
      {
        status: 'validation-alias-failed',
        mutate(value: ReturnType<typeof JSON.parse>) {
          value.sections[0].sourceAliases = ['S2'];
        },
      },
      {
        status: 'validation-content-negative-not-found-failed',
        mutate(value: ReturnType<typeof JSON.parse>) {
          value.sections[0].content = `未發現${'重'.repeat(37)}`;
        },
      },
      {
        status: 'validation-content-negative-normal-failed',
        mutate(value: ReturnType<typeof JSON.parse>) {
          value.sections[0].content = `結果正常${'重'.repeat(36)}`;
        },
      },
      {
        status: 'validation-content-negative-none-word-unrelated-to-allergy-failed',
        mutate(value: ReturnType<typeof JSON.parse>) {
          value.sections[0].content = `無法確認${'重'.repeat(36)}`;
        },
      },
      {
        status: 'validation-content-metadata-failed',
        mutate(value: ReturnType<typeof JSON.parse>) {
          value.sections[0].content = `S2${'重'.repeat(38)}`;
        },
      },
      {
        status: 'validation-content-bounds-failed',
        mutate(value: ReturnType<typeof JSON.parse>) {
          value.sections[0].content = '重'.repeat(801);
        },
      },
      {
        status: 'validation-length-failed',
        mutate(value: ReturnType<typeof JSON.parse>) {
          value.sections[0].content = '重'.repeat(200);
        },
      },
    ] as const;

    for (const testCase of cases) {
      const output = JSON.parse(providerOutput());
      testCase.mutate(output);
      const fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({choices: [{message: {content: JSON.stringify(output)}}]}),
      }));
      const provider = createBackgroundProviderBoundary({fetch: fetch as never});
      provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');
      provider.grantRemoteConsent(scope);

      const result = await provider.generate(scope, 'openrouter', request()!);
      expect(result).toEqual({status: testCase.status});
      expect(JSON.stringify(result)).not.toContain('sections');
      expect(JSON.stringify(result)).not.toContain('未發現');
    }
  });

  it('classifies a missing or truncated output from safe envelope metadata only', async () => {
    const responses = [
      {
        expected: 'provider-output-missing',
        payload: {choices: [{finish_reason: 'stop', message: {content: null}}]},
      },
      {
        expected: 'provider-output-truncated',
        payload: {choices: [{finish_reason: 'length', message: {content: providerOutput()}}]},
      },
    ] as const;

    for (const response of responses) {
      const fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => response.payload,
      }));
      const provider = createBackgroundProviderBoundary({fetch: fetch as never});
      provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');
      provider.grantRemoteConsent(scope);

      await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toEqual({
        status: response.expected,
      });
    }
  });

  it('classifies an Ollama length stop before parsing its partial structured output', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        done: true,
        done_reason: 'length',
        response: '{"schemaVersion":"clinical-summary.v1"',
      }),
    }));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});

    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toEqual({
      status: 'provider-output-truncated',
    });
  });

  it('reports a provider HTTP rejection without exposing its status or body', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({error: 'synthetic provider rejection'}),
    }));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});

    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toEqual({status: 'provider-http-failed'});
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
    expect(sent.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'fixed_five_section_clinical_summary',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'timeWindows', 'sections'],
        },
      },
    });
    expect(sent.response_format.json_schema.schema.properties.sections.items.properties.heading.enum)
      .toEqual(['核對重點', '目前用藥與過敏', '近期病程與檢查', '住院、手術與出院', '資料缺口與待確認']);
    expect(sent.response_format.json_schema.schema.properties.sections.items.properties.content.description)
      .toContain('local-rendered');
    expect(JSON.stringify(sent.response_format)).not.toContain('sourceRef');
    expect(sent).not.toHaveProperty('route');
    expect(sent.messages[0]).toMatchObject({role: 'system'});
    expect(sent.messages[1]).toMatchObject({role: 'user'});
    expect(sent.messages[1].content).not.toContain('pt_provider_patient_00001');
  });

  it('requires strict structured output so OpenRouter cannot return an unparseable document', async () => {
    const fetch = vi.fn(async (_url: string, init: Request['init']) => {
      const sent = JSON.parse(init.body);
      const strictJsonSchema = sent.response_format?.type === 'json_schema' &&
        sent.response_format?.json_schema?.strict === true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{message: {content: strictJsonSchema
            ? providerOutput()
            : `\`\`\`json\n${providerOutput()}\n\`\`\``}}],
        }),
      };
    });
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});
    provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');
    provider.grantRemoteConsent(scope);

    await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('requires schema-constrained output so Ollama cannot return an unparseable document', async () => {
    const fetch = vi.fn(async (_url: string, init: Request['init']) => {
      const sent = JSON.parse(init.body);
      const hasFixedRequest = JSON.stringify(sent.format) ===
          JSON.stringify(FIXED_FIVE_SECTION_PROVIDER_JSON_SCHEMA) &&
        sent.options?.temperature === 0 && sent.options?.seed === 0 &&
        sent.options?.num_ctx === 32_768 && sent.options?.num_predict === 1_024 &&
        sent.format?.properties?.sections?.items?.properties?.content?.minLength === 30 &&
        sent.format?.properties?.sections?.items?.properties?.content?.maxLength === 65 &&
        sent.format?.properties?.sections?.items?.properties?.sourceAliases?.maxItems === 20 &&
        sent.think === false;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: hasFixedRequest
            ? providerOutput()
            : `\`\`\`json\n${providerOutput()}\n\`\`\``,
        }),
      };
    });
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});

    await expect(provider.generate(scope, 'ollama', request()!)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('keeps the Provider task fact-only while local rendering owns coverage wording', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (url: string, init: Request['init']) => {
      requests.push({url, init});
      const sent = JSON.parse(init.body);
      const systemPolicy = sent.messages?.[0]?.role === 'system' &&
        sent.messages[0].content.includes('not-collected') &&
        sent.messages[0].content.includes('local-rendered');
      const sealedCoveragePolicy = sent.messages?.[1]?.role === 'user' &&
        sent.messages[1].content.includes('"coveragePolicy"') &&
        sent.messages[1].content.includes('"not-collected":"local-rendered"');
      const output = JSON.parse(providerOutput());
      if (!systemPolicy || !sealedCoveragePolicy) {
        output.sections[0].content = `未發現用藥資料${'重'.repeat(34)}`;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(output)}}]}),
      };
    });
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});
    provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');
    provider.grantRemoteConsent(scope);

    await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toMatchObject({
      status: 'completed',
    });
    const sent = JSON.parse(requests[0]!.init.body);
    expect(sent.messages.map((message: {role: string}) => message.role)).toEqual(['system', 'user']);
    expect(sent.messages[0].content).not.toContain('Synthetic analyte');
    expect(sent.messages[0].content).toContain('只摘要 has-data facts');
    expect(sent.messages[0].content).toContain('本節內容由本機固定取代');
    expect(sent.messages[0].content).not.toContain('空 content');
    expect(sent.messages[1].content).not.toContain('pt_provider_patient_00001');
  });

  it('renders lab-only coverage sections locally instead of accepting Provider gap prose', async () => {
    const output = JSON.parse(providerOutput());
    output.sections[0].content = '重'.repeat(45);
    output.sections[1] = {
      heading: '目前用藥與過敏', content: `無法確認${'要'.repeat(35)}`, sourceAliases: ['S1'],
    };
    output.sections[2].content = '點'.repeat(45);
    output.sections[3] = {
      heading: '住院、手術與出院', content: `無法確認${'資'.repeat(35)}`, sourceAliases: ['S1'],
    };
    output.sections[4] = {
      heading: '資料缺口與待確認',
      content: `資料缺口：無法確認；待確認：${'核'.repeat(70)}`,
      sourceAliases: ['S1'],
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(output)}}]}),
    }));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});
    provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');
    provider.grantRemoteConsent(scope);

    await expect(provider.generate(scope, 'openrouter', request()!)).resolves.toEqual({
      status: 'completed',
      summary: expect.objectContaining({
        sections: expect.arrayContaining([
          {
            heading: '目前用藥與過敏',
            content: '西藥：資料缺口，待確認；中藥：資料缺口，待確認；過敏：資料缺口，待確認。',
            sourceRefs: [],
          },
          {
            heading: '住院、手術與出院',
            content: '就醫：資料缺口，待確認；處置：資料缺口，待確認；出院：資料缺口，待確認。',
            sourceRefs: [],
          },
          {
            heading: '資料缺口與待確認',
            content: '就醫、西藥、中藥、過敏、影像、處置、出院、成人健檢、癌症篩檢、B/C 型肝炎及 CKM 衍生資料：資料缺口，待確認。',
            sourceRefs: [],
          },
        ]),
      }),
    });
  });

  it('renders every section locally when the sealed snapshot has no collected facts', async () => {
    const output = JSON.parse(providerOutput());
    for (const section of output.sections) {
      section.content = `無法確認${'待'.repeat(42)}`;
      section.sourceAliases = [];
    }
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(output)}}]}),
    }));
    const provider = createBackgroundProviderBoundary({fetch: fetch as never});
    provider.storeOpenRouterSessionSecret(scope, 'synthetic-byok-value');
    provider.grantRemoteConsent(scope);

    const result = await provider.generate(scope, 'openrouter', emptyRequest()!);
    expect(result).toEqual({
      status: 'completed',
      summary: expect.objectContaining({
        sections: [
          {
            heading: '核對重點',
            content: '目前僅有資料涵蓋狀態，未提供可供核對的已收集臨床事實；所有類別均須依固定資料缺口規則由人工確認，不得據此推定任何未提供的臨床結論。',
            sourceRefs: [],
          },
          {
            heading: '目前用藥與過敏',
            content: '西藥：資料缺口，待確認；中藥：資料缺口，待確認；過敏：資料缺口，待確認。',
            sourceRefs: [],
          },
          {
            heading: '近期病程與檢查',
            content: '就醫：資料缺口，待確認；檢驗：無可用資料；影像：資料缺口，待確認。',
            sourceRefs: [],
          },
          {
            heading: '住院、手術與出院',
            content: '就醫：資料缺口，待確認；處置：資料缺口，待確認；出院：資料缺口，待確認。',
            sourceRefs: [],
          },
          {
            heading: '資料缺口與待確認',
            content: '檢驗：無可用資料；就醫、西藥、中藥、過敏、影像、處置、出院、成人健檢、癌症篩檢、B/C 型肝炎及 CKM 衍生資料：資料缺口，待確認。',
            sourceRefs: [],
          },
        ],
      }),
    });
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
