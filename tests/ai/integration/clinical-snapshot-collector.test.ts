import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {resolveVaultReference} from '../../../src/ai/contracts/referenceVault';
import {createClinicalSnapshotCollector} from '../../../src/ai/integration/clinicalSnapshotCollector';

const scope = {
  patientId: 'pt_clinical_collector_patient_00001',
  sessionId: 'ds_clinical_collector_session_00001',
  revision: 1,
};

function collector() {
  let sourceNumber = 0;
  return createClinicalSnapshotCollector({
    now: () => '2026-08-25T00:00:00.000Z',
    issueSourceReference: () => `sr_clinical_collector_${String(++sourceNumber).padStart(8, '0')}`,
  });
}

function success(dataType: string, row: object) {
  return {status: 'success', dataType, recordCount: 1, data: {rObject: [row]}};
}

function fullSpectrumBatch() {
  return [
    success('encounter', {
      date: '2026/08/20', facility: 'Synthetic Clinic', encounter_type: 'outpatient',
      diagnosis_code: 'Z00.0', diagnosis_name: 'Synthetic encounter diagnosis',
    }),
    success('medication', {
      drug_date: '2026/08/20', hosp: 'Synthetic Clinic;門診;0000000000',
      drug_ename: 'Synthetic western medicine', drug_ing_name: 'Synthetic ingredient',
      qty: 6, drug_fre: 'BID', day: 3,
    }),
    success('chinesemed', {
      func_date: '2026-08-20T00:00:00', hosp: 'Synthetic Chinese Clinic;門診;0000000000',
      drug_perscrn_name: 'Synthetic Chinese medicine', order_qty: 9, drug_fre: 'TID', day: 3,
    }),
    success('allergy', {
      upload_d: '115/08/20', hosp: 'Synthetic Clinic;0000000000', drug_name: 'Synthetic allergen;;',
      sympton_name: 'Synthetic reaction', allerg_severity_level: 'moderate',
    }),
    success('labdata', {
      real_inspect_date: '2026/08/20', hosp: 'Synthetic Laboratory;門診;0000000000',
      order_code: 'LAB-001', assay_item_name: 'Synthetic analyte', assay_value: '12.3',
      unit_data: 'mg/dL', consult_value: '10-14', assay_mark: 'H',
    }),
    success('imaging', {
      real_inspect_date: '2026/08/20', hosp: 'Synthetic Imaging;門診;0000000000',
      order_code: 'IMG-001', order_name: 'Synthetic scan', cure_path_name: 'Synthetic body site',
      inspect_result: 'Synthetic report.\n', path_diag_2: 'Synthetic impression.',
    }),
    success('surgery', {
      exe_s_date: '2026-08-20T00:00:00', hosp: 'Synthetic Hospital;急診/住院;0000000000',
      order_code: 'PROC-001', order_ename: 'Synthetic procedure',
      icd_code: 'Z00.0', icd_cname: 'Synthetic indication',
    }),
    success('discharge', {
      in_date: '2026-08-18T00:00:00', out_date: '2026-08-20T00:00:00',
      hosp: 'Synthetic Hospital;0000000000', icd_code: 'Z00.0',
      icd_cname: 'Synthetic discharge diagnosis', summary_text: 'Synthetic discharge summary.',
    }),
  ];
}

describe('revision-wide clinical snapshot collector', () => {
  it('collects and seals every phase-one family through one interface', () => {
    const result = collector().ingest(scope, fullSpectrumBatch());

    expect(result).not.toBeNull();
    expect(result?.sealed.snapshot.records).toHaveLength(8);
    for (const coverage of Object.values(result?.sealed.snapshot.coverage ?? {}).slice(0, 8)) {
      expect(coverage).toEqual({status: 'has-data', recordCount: 1});
    }
    expect(result?.sourceAliases.map((source) => source.label)).toEqual([
      '就醫來源 1', '西藥來源 1', '中藥來源 1', '過敏來源 1',
      '檢驗來源 1', '影像來源 1', '處置來源 1', '出院來源 1',
    ]);
    expect(resolveVaultReference(
      result?.sealed.referenceVault,
      result?.sourceAliases[7]?.sourceRef,
      {sessionId: scope.sessionId, revision: 1, contractVersion: 'clinical-projection.v1'},
    )).toEqual({sourceFamily: 'discharge', recordIndex: 0});
  });

  it('keeps one malformed family quarantined while preserving other terminal states', () => {
    const result = collector().ingest(scope, [
      success('medication', {
        drug_date: '2026/08/20', hosp: 'Synthetic Clinic;門診',
        drug_ename: '<b>unsafe</b>', qty: 1, drug_fre: 'QD', day: 1,
      }),
      {status: 'nodata', dataType: 'chinesemed', recordCount: 0},
      {
        status: 'unauthorized', dataType: 'allergy', recordCount: 0,
        reasonCode: 'SOURCE_UNAUTHORIZED',
      },
      {
        status: 'failure', dataType: 'imaging', recordCount: 0,
        reasonCode: 'SOURCE_REQUEST_FAILED',
      },
      fullSpectrumBatch()[4],
    ]);

    expect(result?.sealed.snapshot.coverage).toMatchObject({
      'western-medication': {
        status: 'normalization-failure', recordCount: 0,
        reasonCode: 'SOURCE_TEXT_SANITIZATION_FAILED',
      },
      'chinese-medication': {status: 'confirmed-empty', recordCount: 0},
      allergy: {status: 'unauthorized', recordCount: 0, reasonCode: 'SOURCE_UNAUTHORIZED'},
      imaging: {status: 'fetch-failure', recordCount: 0, reasonCode: 'SOURCE_REQUEST_FAILED'},
      lab: {status: 'has-data', recordCount: 1},
      encounter: {status: 'not-collected', recordCount: 0, reasonCode: 'SOURCE_NOT_COLLECTED'},
    });
    expect(result?.sealed.snapshot.records).toHaveLength(1);
    expect(result?.sealed.snapshot.records[0]?.sourceFamily).toBe('lab');
  });

  it('rejects duplicate family results and requires a newer revision with fresh references', () => {
    const deepModule = collector();
    expect(deepModule.ingest(scope, [fullSpectrumBatch()[4], fullSpectrumBatch()[4]])).toBeNull();

    const first = deepModule.ingest(scope, fullSpectrumBatch());
    const stale = deepModule.ingest(scope, fullSpectrumBatch());
    const next = deepModule.ingest({...scope, revision: 2}, fullSpectrumBatch());

    expect(first).not.toBeNull();
    expect(stale).toBeNull();
    expect(next?.sealed.snapshot.revision).toBe(2);
    expect(next?.sourceAliases[0]?.sourceRef).not.toBe(first?.sourceAliases[0]?.sourceRef);
  });

  it('accepts the maintained product-fixture shapes without leaking raw identifiers or file handles', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('../../test_data/demoPatient_on_NHIcloud2_240414.json', import.meta.url),
      'utf8',
    )) as Record<string, {readonly rObject?: readonly unknown[]}>;
    const dataTypes = [
      ['medication', 'medication'], ['chinesemed', 'chinesemed'], ['allergy', 'allergy'],
      ['labdata', 'lab'], ['imaging', 'imaging'], ['surgery', 'surgery'], ['discharge', 'discharge'],
    ] as const;
    const batch = dataTypes.map(([dataType, fixtureKey]) => ({
      status: 'success',
      dataType,
      recordCount: fixture[fixtureKey]?.rObject?.length ?? 0,
      data: {rObject: fixture[fixtureKey]?.rObject ?? []},
    }));

    const result = collector().ingest(scope, batch);

    expect(result).not.toBeNull();
    expect(Object.fromEntries(Object.entries(result?.sealed.snapshot.coverage ?? {}).map(
      ([family, coverage]) => [family, coverage.status],
    ))).toMatchObject({
      'western-medication': 'has-data', 'chinese-medication': 'has-data',
      allergy: 'has-data', lab: 'has-data', imaging: 'has-data', procedure: 'has-data',
      discharge: 'has-data',
    });
    expect(result?.sealed.snapshot.coverage.encounter.status).toBe('not-collected');
    const serialized = JSON.stringify(result?.sealed.snapshot);
    for (const forbidden of ['hosp_id', 'mds_file', 'mds_pdf_file', 'ipl_case_seq_no', 'drug_ing_code']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
