import { describe, expect, it } from 'vitest';

import { createLabVerticalSlice } from '../../../src/ai/integration/labVerticalSlice';
import { createSealedSummaryRequest, parseProviderSummaryOutput } from '../../../src/ai/summary/providerRequest';

function setup() {
  const vertical = createLabVerticalSlice({
    now: () => '2026-08-21T00:00:00.000Z',
    issueSourceReference: () => 'sr_r2_provider_source_000001',
  });
  const scope = {
    tabId: 9, patientId: 'pt_r2_provider_patient_00001', sessionId: 'ds_r2_provider_session_00001',
    revision: 1, contractVersion: 'clinical-projection.v1',
  } as const;
  const sealed = vertical.ingest(scope, {
    status: 'success', dataType: 'labdata', recordCount: 1,
    data: {rObject: [{
      hosp: 'Synthetic Lab;outpatient;0000000000', real_inspect_date: '2026/08/20',
      order_code: 'LAB-001', assay_item_name: 'Synthetic analyte', assay_value: '1.0',
      unit_data: 'mg/dL', consult_value: '0-2', assay_mark: '0',
    }]},
  })?.sealed;
  return {scope, sealed, request: createSealedSummaryRequest(scope, sealed)};
}

function output(sourceAliases: string[]) {
  return JSON.stringify({
    schemaVersion: 'clinical-summary.v1',
    timeWindows: {
      medicationsAndAllergies: 'current-available-data', recentCourseAndTests: 'past-90-days',
      admissionsProceduresAndDischarge: 'past-1-year',
    },
    sections: [
      {heading: '核對重點', content: '重'.repeat(40), sourceAliases},
      {heading: '目前用藥與過敏', content: '要'.repeat(40), sourceAliases},
      {heading: '近期病程與檢查', content: '點'.repeat(40), sourceAliases},
      {heading: '住院、手術與出院', content: '資'.repeat(40), sourceAliases: []},
      {heading: '資料缺口與待確認', content: `資料缺口：${'待'.repeat(40)}；待確認：${'核'.repeat(40)}`, sourceAliases: []},
    ],
  });
}

describe('sealed provider request and source alias round-trip', () => {
  it('admits only an exact sealed scope and omits internal identity from the fixed prompt', () => {
    const {scope, sealed, request} = setup();
    expect(request).not.toBeNull();
    expect(request?.prompt).toContain('S1');
    expect(request?.prompt).toContain('"coveragePolicy"');
    expect(request?.prompt).toContain('"confirmed-empty":"local-rendered"');
    expect(request?.prompt).toContain('"not-collected":"local-rendered"');
    expect(request?.prompt).not.toContain('你只能依據提供的臨床投影');
    expect(request?.prompt).not.toContain(scope.patientId);
    expect(request?.prompt).not.toContain(scope.sessionId);
    expect(request?.prompt).not.toContain('sr_r2_provider_source_000001');
    expect(createSealedSummaryRequest({...scope, revision: 2}, sealed)).toBeNull();
    expect(createSealedSummaryRequest(scope, {snapshot: sealed?.snapshot, referenceVault: {entries: []}})).toBeNull();
  });

  it('strictly maps only known aliases back to local opaque references and rejects partial output', () => {
    const {request} = setup();
    const accepted = parseProviderSummaryOutput(output(['S1']), request!);
    expect(accepted?.sections[0]?.sourceRefs).toEqual(['sr_r2_provider_source_000001']);
    expect(parseProviderSummaryOutput(output(['S2']), request!)).toBeNull();
    expect(parseProviderSummaryOutput('{"sections":[]}', request!)).toBeNull();
    expect(parseProviderSummaryOutput(`${output(['S1'])}\npartial`, request!)).toBeNull();
  });
});
