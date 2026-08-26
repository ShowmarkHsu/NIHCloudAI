import {readFileSync} from 'node:fs';

import {expect, it} from 'vitest';

import {createClinicalSnapshotCollector} from '../../../src/ai/integration/clinicalSnapshotCollector';
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

controlledIt('completes the fixed Ollama boundary with sealed synthetic has-data facts', async () => {
  const scope = {
    tabId: 24,
    sessionId: 'ds_controlled_ollama_0002',
    revision: 1,
  } as const;
  const vertical = createLabVerticalSlice({
    now: () => '2026-08-25T00:00:00.000Z',
    issueSourceReference: () => 'sr_controlled_ollama_000002',
  });
  const sealed = vertical.ingest({
    patientId: 'pt_controlled_ollama_00002',
    sessionId: scope.sessionId,
    revision: scope.revision,
  }, {
    status: 'success',
    dataType: 'labdata',
    recordCount: 1,
    data: {rObject: [{
      hosp: 'Synthetic Laboratory;outpatient;0000000000',
      real_inspect_date: '2026/08/20',
      order_code: 'LAB-SYN-001',
      assay_item_name: 'Synthetic analyte',
      assay_value: '12.3',
      unit_data: 'mg/dL',
      consult_value: '10-14',
      assay_mark: 'H',
    }]},
  })?.sealed;
  const request = createSealedSummaryRequest({
    ...scope,
    patientId: 'pt_controlled_ollama_00002',
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

controlledIt('completes the fixed Ollama boundary with source-stated no-known-allergy', async () => {
  const scope = {
    tabId: 28,
    sessionId: 'ds_controlled_ollama_0005',
    revision: 1,
  } as const;
  let sourceNumber = 0;
  const collector = createClinicalSnapshotCollector({
    now: () => '2026-08-25T00:00:00.000Z',
    issueSourceReference: () => `sr_controlled_ollama_allergy_${String(++sourceNumber).padStart(6, '0')}`,
  });
  const collected = collector.ingest({
    patientId: 'pt_controlled_ollama_00005',
    sessionId: scope.sessionId,
    revision: scope.revision,
  }, [
    {
      status: 'success',
      dataType: 'medication',
      recordCount: 1,
      data: {rObject: [{
        drug_date: '2026/08/20',
        hosp: 'Synthetic Clinic;outpatient;0000000000',
        drug_ename: 'Synthetic western medicine',
        drug_ing_name: 'Synthetic ingredient',
        qty: 6,
        drug_fre: 'BID',
        day: 3,
      }]},
    },
    {
      status: 'success',
      dataType: 'allergy',
      recordCount: 1,
      data: {rObject: [{
        upload_d: '115/08/20',
        hosp: 'Synthetic Clinic;0000000000',
        drug_name: '未過敏;;',
      }]},
    },
  ]);
  const request = createSealedSummaryRequest({
    ...scope,
    patientId: 'pt_controlled_ollama_00005',
    contractVersion: 'clinical-projection.v1',
  }, collected?.sealed);
  expect(request).not.toBeNull();

  const provider = createBackgroundProviderBoundary({
    fetch: ((url: string, init: RequestInit) => globalThis.fetch(url, init)) as never,
    ensureOptionalHostPermission: async () => true,
  });
  const result = await provider.generate(scope, 'ollama', request!);

  expect(result.status).toBe('completed');
}, 190_000);

controlledIt('completes the fixed Ollama boundary with every synthetic phase-one family', async () => {
  const scope = {
    tabId: 25,
    sessionId: 'ds_controlled_ollama_0003',
    revision: 1,
  } as const;
  let sourceNumber = 0;
  const collector = createClinicalSnapshotCollector({
    now: () => '2026-08-25T00:00:00.000Z',
    issueSourceReference: () => `sr_controlled_ollama_${String(++sourceNumber).padStart(6, '0')}`,
  });
  const success = (dataType: string, row: object) => ({
    status: 'success' as const,
    dataType,
    recordCount: 1,
    data: {rObject: [row]},
  });
  const collected = collector.ingest({
    patientId: 'pt_controlled_ollama_00003',
    sessionId: scope.sessionId,
    revision: scope.revision,
  }, [
    success('encounter', {
      date: '2026/08/20', facility: 'Synthetic Clinic', encounter_type: 'outpatient',
      diagnosis_code: 'Z00.0', diagnosis_name: 'Synthetic encounter diagnosis',
    }),
    success('medication', {
      drug_date: '2026/08/20', hosp: 'Synthetic Clinic;outpatient;0000000000',
      drug_ename: 'Synthetic western medicine', drug_ing_name: 'Synthetic ingredient',
      qty: 6, drug_fre: 'BID', day: 3,
    }),
    success('chinesemed', {
      func_date: '2026-08-20T00:00:00', hosp: 'Synthetic Chinese Clinic;outpatient;0000000000',
      drug_perscrn_name: 'Synthetic Chinese medicine', order_qty: 9, drug_fre: 'TID', day: 3,
    }),
    success('allergy', {
      upload_d: '115/08/20', hosp: 'Synthetic Clinic;0000000000', drug_name: 'Synthetic allergen;;',
      sympton_name: 'Synthetic reaction', allerg_severity_level: 'moderate',
    }),
    success('labdata', {
      real_inspect_date: '2026/08/20', hosp: 'Synthetic Laboratory;outpatient;0000000000',
      order_code: 'LAB-001', assay_item_name: 'Synthetic analyte', assay_value: '12.3',
      unit_data: 'mg/dL', consult_value: '10-14', assay_mark: 'H',
    }),
    success('imaging', {
      real_inspect_date: '2026/08/20', hosp: 'Synthetic Imaging;outpatient;0000000000',
      order_code: 'IMG-001', order_name: 'Synthetic scan', cure_path_name: 'Synthetic body site',
      inspect_result: 'Synthetic report.', path_diag_2: 'Synthetic impression.',
    }),
    success('surgery', {
      exe_s_date: '2026-08-20T00:00:00', hosp: 'Synthetic Hospital;inpatient;0000000000',
      order_code: 'PROC-001', order_ename: 'Synthetic procedure',
      icd_code: 'Z00.0', icd_cname: 'Synthetic indication',
    }),
    success('discharge', {
      in_date: '2026-08-18T00:00:00', out_date: '2026-08-20T00:00:00',
      hosp: 'Synthetic Hospital;0000000000', icd_code: 'Z00.0',
      icd_cname: 'Synthetic discharge diagnosis', summary_text: 'Synthetic discharge summary.',
    }),
  ]);
  const request = createSealedSummaryRequest({
    ...scope,
    patientId: 'pt_controlled_ollama_00003',
    contractVersion: 'clinical-projection.v1',
  }, collected?.sealed);
  expect(request).not.toBeNull();

  const provider = createBackgroundProviderBoundary({
    fetch: ((url: string, init: RequestInit) => globalThis.fetch(url, init)) as never,
    ensureOptionalHostPermission: async () => true,
  });
  const result = await provider.generate(scope, 'ollama', request!);

  expect(result.status).toBe('completed');
}, 190_000);

controlledIt('completes the fixed Ollama boundary with the maintained full product fixture', async () => {
  const scope = {
    tabId: 26,
    sessionId: 'ds_controlled_ollama_0004',
    revision: 1,
  } as const;
  let sourceNumber = 0;
  const collector = createClinicalSnapshotCollector({
    now: () => '2026-08-25T00:00:00.000Z',
    issueSourceReference: () => `sr_controlled_ollama_${String(++sourceNumber).padStart(6, '0')}`,
  });
  const fixture = JSON.parse(readFileSync(
    new URL('../../test_data/demoPatient_on_NHIcloud2_240414.json', import.meta.url),
    'utf8',
  )) as Record<string, {readonly rObject?: readonly unknown[]}>;
  const dataTypes = [
    ['medication', 'medication'], ['chinesemed', 'chinesemed'], ['allergy', 'allergy'],
    ['labdata', 'lab'], ['imaging', 'imaging'], ['surgery', 'surgery'], ['discharge', 'discharge'],
  ] as const;
  const collected = collector.ingest({
    patientId: 'pt_controlled_ollama_00004',
    sessionId: scope.sessionId,
    revision: scope.revision,
  }, dataTypes.map(([dataType, fixtureKey]) => ({
    status: 'success' as const,
    dataType,
    recordCount: fixture[fixtureKey]?.rObject?.length ?? 0,
    data: {rObject: fixture[fixtureKey]?.rObject ?? []},
  })));
  const request = createSealedSummaryRequest({
    ...scope,
    patientId: 'pt_controlled_ollama_00004',
    contractVersion: 'clinical-projection.v1',
  }, collected?.sealed);
  expect(request).not.toBeNull();
  expect(request!.prompt.length).toBeLessThan(22_000);

  const provider = createBackgroundProviderBoundary({
    fetch: ((url: string, init: RequestInit) => globalThis.fetch(url, init)) as never,
    ensureOptionalHostPermission: async () => true,
  });
  const result = await provider.generate(scope, 'ollama', request!);

  expect(result.status).toBe('completed');
}, 190_000);
