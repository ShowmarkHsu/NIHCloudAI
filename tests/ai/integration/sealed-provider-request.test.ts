import { describe, expect, it } from 'vitest';

import { createLabVerticalSlice } from '../../../src/ai/integration/labVerticalSlice';
import {createClinicalSnapshotCollector} from '../../../src/ai/integration/clinicalSnapshotCollector';
import {
  createSealedSummaryRequest,
  parseProviderSummaryOutput,
  validateProviderSummaryOutput,
} from '../../../src/ai/summary/providerRequest';

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

function noKnownAllergyRequest(rows: readonly object[] = [{
  upload_d: '115/08/20', hosp: 'Synthetic Clinic;0000000000', drug_name: '未過敏;;',
}]) {
  const scope = {
    tabId: 10, patientId: 'pt_no_known_allergy_000001', sessionId: 'ds_no_known_allergy_000001',
    revision: 1, contractVersion: 'clinical-projection.v1',
  } as const;
  let sourceNumber = 0;
  const collector = createClinicalSnapshotCollector({
    now: () => '2026-08-21T00:00:00.000Z',
    issueSourceReference: () => `sr_no_known_allergy_${String(++sourceNumber).padStart(6, '0')}`,
  });
  const sealed = collector.ingest(scope, [{
    status: 'success', dataType: 'allergy', recordCount: rows.length,
    data: {rObject: rows},
  }])?.sealed;
  return createSealedSummaryRequest(scope, sealed);
}

describe('sealed provider request and source alias round-trip', () => {
  it('admits only an exact sealed scope and omits internal identity from the fixed prompt', () => {
    const {scope, sealed, request} = setup();
    expect(request).not.toBeNull();
    expect(request?.prompt).toContain('S1');
    expect(request?.prompt).toContain('"factTables"');
    expect(request?.prompt).toContain('"columns":["sourceAlias"');
    expect(request?.prompt).not.toContain('"facts"');
    expect(request?.prompt).toContain('"coveragePolicy"');
    expect(request?.prompt).toContain('"allergyEvidencePolicy":"allergy-negative-findings-require-explicit-sealed-no-known-allergy-fact-v2;noneCharacterLimit=0;unsupportedAllergyWording=forbidden"');
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

  it('canonicalizes only redundant declared aliases out of content and rejects undeclared ones', () => {
    const {request} = setup();
    const declared = JSON.parse(output(['S1']));
    declared.sections[0].content = `S1${'重'.repeat(40)}`;
    const accepted = parseProviderSummaryOutput(JSON.stringify(declared), request!);

    expect(accepted?.sections[0]?.content).toBe('重'.repeat(40));
    expect(accepted?.sections[0]?.sourceRefs).toEqual(['sr_r2_provider_source_000001']);

    const undeclared = JSON.parse(output(['S1']));
    undeclared.sections[0].content = `S2${'重'.repeat(40)}`;
    expect(parseProviderSummaryOutput(JSON.stringify(undeclared), request!)).toBeNull();
  });

  it('canonicalizes only source-supported no-known-allergy wording and keeps other none-word uses closed', () => {
    const request = noKnownAllergyRequest();
    expect(request).not.toBeNull();
    const supported = JSON.parse(output(['S1']));
    supported.sections[0].content = `來源顯示無已知過敏紀錄，${'重'.repeat(25)}`;
    supported.sections[1].content = `目前無已知藥物過敏，${'要'.repeat(25)}`;
    supported.sections[1].sourceAliases = [];
    const accepted = parseProviderSummaryOutput(JSON.stringify(supported), request!);
    expect(accepted).not.toBeNull();
    expect(accepted?.sections[0]?.content).not.toContain('無');
    expect(accepted?.sections[1]?.content).not.toContain('無');
    expect(accepted?.sections[1]?.sourceRefs).toEqual(['sr_no_known_allergy_000001']);

    const safeLexicalOverlap = JSON.parse(output(['S1']));
    safeLexicalOverlap.sections[1].content = `目前無用藥物過敏，${'要'.repeat(26)}`;
    expect(parseProviderSummaryOutput(JSON.stringify(safeLexicalOverlap), request!)).not.toBeNull();

    const unsupportedSource = JSON.parse(JSON.stringify(supported));
    expect(parseProviderSummaryOutput(JSON.stringify(unsupportedSource), setup().request!)).toBeNull();

    const unrelatedNone = JSON.parse(output(['S1']));
    unrelatedNone.sections[0].content = `目前無用藥紀錄，${'重'.repeat(26)}`;
    expect(parseProviderSummaryOutput(JSON.stringify(unrelatedNone), request!)).toBeNull();
    const combinedNone = JSON.parse(output(['S1']));
    combinedNone.sections[0].content = `目前無用藥及過敏紀錄，${'重'.repeat(24)}`;
    expect(parseProviderSummaryOutput(JSON.stringify(combinedNone), request!)).toBeNull();

    const conflictingRequest = noKnownAllergyRequest([
      {upload_d: '115/08/20', hosp: 'Synthetic Clinic;0000000000', drug_name: '未過敏;;'},
      {
        upload_d: '115/08/19', hosp: 'Synthetic Clinic;0000000000',
        drug_name: 'Synthetic allergen;;', sympton_name: 'Synthetic reaction',
      },
    ]);
    const conflicting = JSON.parse(output([]));
    conflicting.sections[0].content = `目前無已知過敏紀錄，${'重'.repeat(25)}`;
    conflicting.sections[1].content = `過敏資料顯示無相關紀錄，${'要'.repeat(25)}`;
    const conflictAccepted = parseProviderSummaryOutput(JSON.stringify(conflicting), conflictingRequest!);
    expect(conflictAccepted?.sections[0]?.content).toContain('資料可能矛盾');
    expect(conflictAccepted?.sections[0]?.sourceRefs).toHaveLength(2);
    expect(conflictAccepted?.sections[0]?.content).not.toContain('無');

    const presentOnlyRequest = noKnownAllergyRequest([{
      upload_d: '115/08/19', hosp: 'Synthetic Clinic;0000000000',
      drug_name: 'Synthetic allergen;;', sympton_name: 'Synthetic reaction',
    }]);
    expect(parseProviderSummaryOutput(JSON.stringify(conflicting), presentOnlyRequest!)).toBeNull();
  });

  it('classifies none-word failures without returning provider content', () => {
    const labRequest = setup().request!;
    const noKnownRequest = noKnownAllergyRequest()!;
    const classify = (value: ReturnType<typeof JSON.parse>, request = noKnownRequest) =>
      validateProviderSummaryOutput(JSON.stringify(value), request).status;

    const outsideSupportedSections = JSON.parse(output(['S1']));
    outsideSupportedSections.sections[2].content = `無法確認${'重'.repeat(36)}`;
    const unsupportedSourceCanonicalized = validateProviderSummaryOutput(
      JSON.stringify(outsideSupportedSections),
      labRequest,
    );
    expect(unsupportedSourceCanonicalized.status).toBe('completed');
    expect(unsupportedSourceCanonicalized.status === 'completed' &&
      unsupportedSourceCanonicalized.summary.sections[2]?.content)
      .toBe('本節含未獲已收集來源明示支持的狀態敘述，該敘述不納入摘要，須回到原始紀錄逐項人工核對');
    expect(unsupportedSourceCanonicalized.status === 'completed' &&
      unsupportedSourceCanonicalized.summary.sections[2]?.sourceRefs)
      .toEqual(['sr_r2_provider_source_000001']);
    const labRequestWithSourceNoneWord = Object.freeze({
      ...labRequest,
      sourceContainsNoneWord: Object.freeze({S1: true}),
    });
    expect(classify(outsideSupportedSections, labRequestWithSourceNoneWord))
      .toBe('validation-content-negative-none-word-recent-course-source-supported-failed');

    const multiple = JSON.parse(output(['S1']));
    multiple.sections[0].content = `無已知過敏，無相關過敏${'重'.repeat(27)}`;
    expect(classify(multiple))
      .toBe('validation-content-negative-none-word-multiple-failed');

    const unrelated = JSON.parse(output(['S1']));
    unrelated.sections[0].content = `無法確認${'重'.repeat(36)}`;
    expect(classify(unrelated))
      .toBe('validation-content-negative-none-word-unrelated-to-allergy-failed');

    const unsupportedSource = JSON.parse(output(['S1']));
    unsupportedSource.sections[0].content = `無已知過敏紀錄${'重'.repeat(25)}`;
    expect(classify(unsupportedSource, labRequest))
      .toBe('validation-content-negative-none-word-allergy-source-unsupported-failed');

    const unsupportedPhrase = JSON.parse(output(['S1']));
    unsupportedPhrase.sections[0].content = `無用藥及過敏紀錄${'重'.repeat(26)}`;
    expect(classify(unsupportedPhrase))
      .toBe('validation-content-negative-none-word-allergy-phrase-unsupported-failed');
  });
});
