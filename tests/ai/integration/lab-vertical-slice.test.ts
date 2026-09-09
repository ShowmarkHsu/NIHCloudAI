import { describe, expect, it } from 'vitest';

import { resolveVaultReference } from '../../../src/ai/contracts/referenceVault';
import { createLabVerticalSlice } from '../../../src/ai/integration/labVerticalSlice';

const scope = {
  patientId: 'pt_r1_vertical_patient_00001',
  sessionId: 'ds_r1_vertical_session_00001',
  revision: 1,
};

function terminalLab(records: unknown[]) {
  return {
    status: 'success', dataType: 'labdata', recordCount: records.length,
    data: {rObject: records},
  };
}

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    hosp: 'Synthetic Laboratory;outpatient;0000000000',
    real_inspect_date: '2026/08/20',
    order_code: 'LAB-001',
    assay_item_name: 'Synthetic analyte',
    assay_value: '12.3',
    unit_data: 'mg/dL',
    consult_value: '10-14',
    assay_mark: 'H',
    patient_name: 'must never be projected',
    internal_url: 'https://internal.invalid/must-not-pass-through',
    ...overrides,
  };
}

function slice() {
  let sourceNumber = 0;
  return createLabVerticalSlice({
    now: () => '2026-08-21T00:00:00.000Z',
    issueSourceReference: () => `sr_r1_lab_source_${String(++sourceNumber).padStart(8, '0')}`,
  });
}

describe('R1 laboratory vertical slice', () => {
  it('takes one upstream terminal result through normalization, coverage, vault, and seal without leaking raw fields', () => {
    const result = slice().ingest(scope, terminalLab([sourceRow()]));

    expect(result).not.toBeNull();
    expect(result?.sealed.snapshot.coverage.lab).toEqual({status: 'has-data', recordCount: 1});
    expect(result?.sealed.snapshot.coverage.imaging).toEqual({
      status: 'not-collected', recordCount: 0, reasonCode: 'SOURCE_NOT_COLLECTED',
    });
    expect(result?.sealed.snapshot.records).toEqual([expect.objectContaining({
      sourceFamily: 'lab', date: '2026-08-20', facility: 'Synthetic Laboratory',
      itemCode: 'LAB-001', itemName: 'Synthetic analyte', normalizedValue: 12.3,
      sourceAbnormalFlag: 'high',
    })]);
    expect(JSON.stringify(result?.sealed.snapshot)).not.toContain('patient_name');
    expect(JSON.stringify(result?.sealed.snapshot)).not.toContain('internal_url');
    expect(result?.sourceAliases).toEqual([{sourceRef: 'sr_r1_lab_source_00000001', label: '檢驗來源 1'}]);
    expect(resolveVaultReference(result?.sealed.referenceVault, 'sr_r1_lab_source_00000001', {
      sessionId: scope.sessionId, revision: 1, contractVersion: 'clinical-projection.v1',
    })).toEqual({sourceFamily: 'lab', recordIndex: 0});
  });

  it('quarantines the entire lab family rather than sealing a partial projection', () => {
    const result = slice().ingest(scope, terminalLab([
      sourceRow(), sourceRow({assay_item_name: '<b>unsafe</b>'}),
    ]));

    expect(result?.sealed.snapshot.records).toEqual([]);
    expect(result?.sealed.snapshot.coverage.lab).toEqual({
      status: 'normalization-failure', recordCount: 0, reasonCode: 'SOURCE_TEXT_SANITIZATION_FAILED',
    });
    expect(result?.sourceAliases).toEqual([]);
  });

  it('requires a new revision and new aliases, then refuses stale or forged input', () => {
    const vertical = slice();
    const first = vertical.ingest(scope, terminalLab([sourceRow()]));
    const stale = vertical.ingest(scope, terminalLab([sourceRow()]));
    const next = vertical.ingest({...scope, revision: 2}, terminalLab([sourceRow()]));
    const malformed = vertical.ingest({...scope, revision: 3}, {status: 'success', dataType: 'labdata'});

    expect(first).not.toBeNull();
    expect(stale).toBeNull();
    expect(next?.sealed.snapshot.revision).toBe(2);
    expect(next?.sourceAliases[0]?.sourceRef).not.toBe(first?.sourceAliases[0]?.sourceRef);
    expect(malformed).toBeNull();
  });
});
