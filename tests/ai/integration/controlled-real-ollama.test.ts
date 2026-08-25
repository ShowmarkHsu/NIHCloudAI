import {expect, it} from 'vitest';

import {createLabVerticalSlice} from '../../../src/ai/integration/labVerticalSlice';
import {createBackgroundProviderBoundary} from '../../../src/ai/providers/backgroundProviderBoundary';
import {createSealedSummaryRequest} from '../../../src/ai/summary/providerRequest';

const controlledIt = process.env.RUN_REAL_OLLAMA === '1' ? it : it.skip;

controlledIt('completes the fixed Ollama boundary with a sealed synthetic coverage-only request', async () => {
  const scope = {
    tabId: 23,
    sessionId: 'ds_controlled_ollama_0001',
    revision: 1,
  } as const;
  const vertical = createLabVerticalSlice({
    now: () => '2026-08-25T00:00:00.000Z',
    issueSourceReference: () => 'sr_controlled_ollama_000001',
  });
  const sealed = vertical.ingest({
    patientId: 'pt_controlled_ollama_00001',
    sessionId: scope.sessionId,
    revision: scope.revision,
  }, {
    status: 'nodata',
    dataType: 'labdata',
    recordCount: 0,
  })?.sealed;
  const request = createSealedSummaryRequest({
    ...scope,
    patientId: 'pt_controlled_ollama_00001',
    contractVersion: 'clinical-projection.v1',
  }, sealed);
  expect(request).not.toBeNull();

  const provider = createBackgroundProviderBoundary({
    fetch: ((url: string, init: RequestInit) => globalThis.fetch(url, init)) as never,
    ensureOptionalHostPermission: async () => true,
  });
  const result = await provider.generate(scope, 'ollama', request!);

  expect(result.status).toBe('completed');
}, 190_000);
