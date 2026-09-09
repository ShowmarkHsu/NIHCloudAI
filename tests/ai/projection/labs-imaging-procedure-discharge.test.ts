import { describe, expect, it } from 'vitest';

import {
  createProjectionReferenceVault,
} from '../../../src/ai/projection/builder';
import { projectDischargeSourceFamily } from '../../../src/ai/projection/sources/discharge';
import { projectImagingSourceFamily } from '../../../src/ai/projection/sources/imaging';
import { projectLabSourceFamily } from '../../../src/ai/projection/sources/lab';
import { projectProcedureSourceFamily } from '../../../src/ai/projection/sources/procedure';
import {
  type SourceFamilySanitizationResult,
} from '../../../src/ai/contracts/projectionSanitizer';
import { resolveVaultReference } from '../../../src/ai/contracts/referenceVault';

const knownDirectIdentifiers = ['Synthetic Patient'];

const vaultScope = {
  sessionId: 'ds_synthetic_b3_sources_0001',
  revision: 1,
  contractVersion: 'clinical-projection.v1',
};

function sourceReferences(...values: string[]): () => unknown {
  let index = 0;
  return () => values[index++];
}

const labInput = [{
  date: '2026-08-14',
  facility: 'Synthetic Laboratory',
  itemCode: 'LAB-001',
  itemName: 'Synthetic analyte',
  sourceValue: '12.3',
  normalizedValue: 12.3,
  unit: 'mg/dL',
  sourceReferenceRange: '10-14',
  sourceAbnormalFlag: 'normal',
}];

const imagingInput = [{
  date: '2026-08-14',
  facility: 'Synthetic Imaging Center',
  examCode: 'IMG-001',
  examName: 'Synthetic scan',
  bodySite: 'Synthetic site',
  reportText: 'De-identified synthetic report.',
}];

const procedureInput = [{
  date: '2026-08-14',
  facility: 'Synthetic General Hospital',
  procedureCode: 'PROC-001',
  procedureName: 'Synthetic procedure',
  sourceDiagnosisCode: 'Z00.0',
  sourceDiagnosisName: 'Synthetic indication',
}];

const dischargeInput = [{
  admissionDate: '2026-08-10',
  dischargeDate: '2026-08-14',
  facility: 'Synthetic General Hospital',
  diagnosisCode: 'Z00.0',
  diagnosisName: 'Synthetic examination',
  summaryText: 'De-identified synthetic discharge summary.',
}];

type SourceFamilyProjector = (
  normalizedRecords: unknown,
  directIdentifiers: unknown,
  issueReference: () => unknown,
) => SourceFamilySanitizationResult;

type AdapterCase = Readonly<{
  sourceFamily: 'lab' | 'imaging' | 'procedure' | 'discharge';
  project: SourceFamilyProjector;
  input: readonly object[];
}>;

const adapterCases: readonly AdapterCase[] = [
  {sourceFamily: 'lab', project: projectLabSourceFamily, input: labInput},
  {
    sourceFamily: 'imaging',
    project: projectImagingSourceFamily,
    input: imagingInput,
  },
  {
    sourceFamily: 'procedure',
    project: projectProcedureSourceFamily,
    input: procedureInput,
  },
  {
    sourceFamily: 'discharge',
    project: projectDischargeSourceFamily,
    input: dischargeInput,
  },
];

describe('B3 lab, imaging, procedure, and discharge source adapters', () => {
  it('projects complete normalized records with explicit canonical fields', () => {
    const lab = projectLabSourceFamily(
      labInput,
      [],
      sourceReferences('sr_lab_b3_synthetic_0001'),
    );
    const imaging = projectImagingSourceFamily(
      imagingInput,
      [],
      sourceReferences('sr_imaging_b3_synthetic_001'),
    );
    const procedure = projectProcedureSourceFamily(
      procedureInput,
      [],
      sourceReferences('sr_procedure_b3_synthetic_01'),
    );
    const discharge = projectDischargeSourceFamily(
      dischargeInput,
      [],
      sourceReferences('sr_discharge_b3_synthetic_01'),
    );

    expect(lab).toEqual({
      status: 'accepted',
      sourceFamily: 'lab',
      records: [{
        sourceFamily: 'lab',
        sourceRef: 'sr_lab_b3_synthetic_0001',
        date: '2026-08-14',
        facility: 'Synthetic Laboratory',
        itemCode: 'LAB-001',
        itemName: 'Synthetic analyte',
        sourceValue: '12.3',
        normalizedValue: 12.3,
        unit: 'mg/dL',
        sourceReferenceRange: '10-14',
        sourceAbnormalFlag: 'normal',
      }],
    });
    expect(imaging).toEqual({
      status: 'accepted',
      sourceFamily: 'imaging',
      records: [{
        sourceFamily: 'imaging',
        sourceRef: 'sr_imaging_b3_synthetic_001',
        date: '2026-08-14',
        facility: 'Synthetic Imaging Center',
        examCode: 'IMG-001',
        examName: 'Synthetic scan',
        bodySite: 'Synthetic site',
        reportText: 'De-identified synthetic report.',
      }],
    });
    expect(procedure).toEqual({
      status: 'accepted',
      sourceFamily: 'procedure',
      records: [{
        sourceFamily: 'procedure',
        sourceRef: 'sr_procedure_b3_synthetic_01',
        date: '2026-08-14',
        facility: 'Synthetic General Hospital',
        procedureCode: 'PROC-001',
        procedureName: 'Synthetic procedure',
        sourceDiagnosis: {code: 'Z00.0', name: 'Synthetic indication'},
      }],
    });
    expect(discharge).toEqual({
      status: 'accepted',
      sourceFamily: 'discharge',
      records: [{
        sourceFamily: 'discharge',
        sourceRef: 'sr_discharge_b3_synthetic_01',
        admissionDate: '2026-08-10',
        dischargeDate: '2026-08-14',
        facility: 'Synthetic General Hospital',
        diagnosis: {code: 'Z00.0', name: 'Synthetic examination'},
        summaryText: 'De-identified synthetic discharge summary.',
      }],
    });

    for (const result of [lab, imaging, procedure, discharge]) {
      expect(result.status).toBe('accepted');
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.records)).toBe(true);
    }
  });

  it('keeps source lab reference range and flag without applying UI rules', () => {
    const result = projectLabSourceFamily(
      [{...labInput[0]!, sourceReferenceRange: 'source says 1-2', sourceAbnormalFlag: 'critical'}],
      [],
      sourceReferences('sr_lab_b3_source_values_01'),
    );

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.records[0]).toMatchObject({
        sourceReferenceRange: 'source says 1-2',
        sourceAbnormalFlag: 'critical',
      });
    }
  });

  it('uses only the aeec581 local reference-vault topology for source refs', () => {
    const results = [
      projectLabSourceFamily(
        labInput,
        [],
        sourceReferences('sr_lab_b3_vault_000001'),
      ),
      projectImagingSourceFamily(
        imagingInput,
        [],
        sourceReferences('sr_imaging_b3_vault_00001'),
      ),
      projectProcedureSourceFamily(
        procedureInput,
        [],
        sourceReferences('sr_procedure_b3_vault_0001'),
      ),
      projectDischargeSourceFamily(
        dischargeInput,
        [],
        sourceReferences('sr_discharge_b3_vault_0001'),
      ),
    ];

    expect(results.every((result) => result.status === 'accepted')).toBe(true);
    const records = results.flatMap((result) =>
      result.status === 'accepted' ? result.records : [],
    );
    const vault = createProjectionReferenceVault(vaultScope, records);
    expect(vault).not.toBeNull();
    expect(vault).not.toHaveProperty('rawPayload');
    expect(vault).not.toHaveProperty('patientId');
    expect(vault).not.toHaveProperty('metadata');
    expect(resolveVaultReference(vault, 'sr_lab_b3_vault_000001', vaultScope)).toEqual({
      sourceFamily: 'lab',
      recordIndex: 0,
    });
    expect(resolveVaultReference(vault, 'sr_discharge_b3_vault_0001', vaultScope)).toEqual({
      sourceFamily: 'discharge',
      recordIndex: 0,
    });
  });

  it('quarantines each complete family for any unknown, missing, wrong-type, identity-tainted, illegal, or overlength field', () => {
    const cases = [
      {field: 'itemName', overlength: 'itemName', illegal: 'itemName'},
      {field: 'examName', overlength: 'reportText', illegal: 'reportText'},
      {field: 'procedureName', overlength: 'procedureName', illegal: 'procedureName'},
      {field: 'diagnosisName', overlength: 'summaryText', illegal: 'summaryText'},
    ] as const;

    for (const [testCase, index] of cases.map((value, valueIndex) => [value, valueIndex] as const)) {
      const adapter = adapterCases[index]!;
      const extra = structuredClone(adapter.input);
      Reflect.set(extra[0]!, 'unexpectedField', 'must-not-pass-through');
      const missing = structuredClone(adapter.input);
      Reflect.deleteProperty(missing[0]!, testCase.field);
      const wrongType = structuredClone(adapter.input);
      Reflect.set(wrongType[0]!, testCase.field, 42);
      const tainted = structuredClone(adapter.input);
      Reflect.set(tainted[0]!, 'facility', 'Synthetic Patient Hospital');
      const illegal = structuredClone(adapter.input);
      Reflect.set(illegal[0]!, testCase.illegal, '<p>not canonical</p>');
      const overlength = structuredClone(adapter.input);
      Reflect.set(overlength[0]!, testCase.overlength, 'x'.repeat(8_001));

      const malformedCases: readonly [unknown, string][] = [
        [extra, 'SOURCE_SCHEMA_REJECTED'],
        [missing, 'SOURCE_SCHEMA_REJECTED'],
        [wrongType, 'SOURCE_SCHEMA_REJECTED'],
        [tainted, 'SOURCE_IDENTITY_TAINT'],
        [illegal, 'SOURCE_TEXT_SANITIZATION_FAILED'],
        [overlength, 'SOURCE_SCHEMA_REJECTED'],
        [[adapter.input[0]!, extra[0]!], 'SOURCE_SCHEMA_REJECTED'],
      ];

      for (const [input, reasonCode] of malformedCases) {
        expect(
          adapter.project(
            input,
            knownDirectIdentifiers,
            sourceReferences('sr_b3_negative_synthetic_0001'),
          ),
        ).toEqual({
          status: 'quarantined',
          sourceFamily: adapter.sourceFamily,
          records: [],
          reasonCode,
        });
      }
    }
  });

  it('rejects URL, file, and internal-ID extras for imaging and discharge', () => {
    for (const adapter of adapterCases.slice(1, 2)) {
      for (const forbiddenField of ['url', 'file', 'internalId', 'fileUrl']) {
        const extra = structuredClone(adapter.input);
        Reflect.set(extra[0]!, forbiddenField, 'https://internal.example/file.pdf');
        const result = adapter.project(
          extra,
          [],
          sourceReferences('sr_imaging_b3_forbidden_01'),
        );
        expect(result).toEqual({
          status: 'quarantined',
          sourceFamily: 'imaging',
          records: [],
          reasonCode: 'SOURCE_SCHEMA_REJECTED',
        });
        expect(JSON.stringify(result)).not.toContain(forbiddenField);
      }
    }

    const dischargeAdapter = adapterCases[3]!;
    for (const forbiddenField of ['url', 'file', 'internalId', 'mds_file']) {
      const extra = structuredClone(dischargeAdapter.input);
      Reflect.set(extra[0]!, forbiddenField, 'internal-file-reference');
      const result = dischargeAdapter.project(
        extra,
        [],
        sourceReferences('sr_discharge_b3_forbidden_01'),
      );
      expect(result).toEqual({
        status: 'quarantined',
        sourceFamily: 'discharge',
        records: [],
        reasonCode: 'SOURCE_SCHEMA_REJECTED',
      });
      expect(JSON.stringify(result)).not.toContain(forbiddenField);
    }
  });

  it('accepts an explicitly null optional text field but never emits partial records', () => {
    const imagingWithoutReport = projectImagingSourceFamily(
      [{...imagingInput[0]!, reportText: null}],
      [],
      sourceReferences('sr_imaging_b3_empty_00001'),
    );
    const procedureWithoutDiagnosis = projectProcedureSourceFamily(
      [{...procedureInput[0]!, sourceDiagnosisCode: null, sourceDiagnosisName: null}],
      [],
      sourceReferences('sr_procedure_b3_empty_001'),
    );
    const dischargeWithoutSummary = projectDischargeSourceFamily(
      [{...dischargeInput[0]!, summaryText: null}],
      [],
      sourceReferences('sr_discharge_b3_empty_001'),
    );

    expect(imagingWithoutReport.status).toBe('accepted');
    expect(procedureWithoutDiagnosis.status).toBe('accepted');
    expect(dischargeWithoutSummary.status).toBe('accepted');
    if (imagingWithoutReport.status === 'accepted') {
      expect(imagingWithoutReport.records[0]).toHaveProperty('reportText', null);
    }
    if (procedureWithoutDiagnosis.status === 'accepted') {
      expect(procedureWithoutDiagnosis.records[0]).toHaveProperty('sourceDiagnosis', null);
    }
    if (dischargeWithoutSummary.status === 'accepted') {
      expect(dischargeWithoutSummary.records[0]).toHaveProperty('summaryText', null);
    }
  });
});
