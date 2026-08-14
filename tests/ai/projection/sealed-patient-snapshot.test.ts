import { describe, expect, it } from 'vitest';

import { resolveVaultReference } from '../../../src/ai/contracts/referenceVault';
import {
  sealVersionedPatientSnapshot,
} from '../../../src/ai/projection/builder';

const phaseOneFamilies = [
  'encounter',
  'western-medication',
  'chinese-medication',
  'allergy',
  'lab',
  'imaging',
  'procedure',
  'discharge',
] as const;

type SnapshotFixture = {
  records: Array<Record<string, unknown>>;
  coverage: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

function coverageFor(recordCounts: Readonly<Record<string, number>>) {
  return {
    encounter: {status: 'has-data', recordCount: recordCounts['encounter']},
    'western-medication': {
      status: 'has-data', recordCount: recordCounts['western-medication'],
    },
    'chinese-medication': {
      status: 'has-data', recordCount: recordCounts['chinese-medication'],
    },
    allergy: {status: 'has-data', recordCount: recordCounts['allergy']},
    lab: {status: 'has-data', recordCount: recordCounts['lab']},
    imaging: {status: 'has-data', recordCount: recordCounts['imaging']},
    procedure: {status: 'has-data', recordCount: recordCounts['procedure']},
    discharge: {status: 'has-data', recordCount: recordCounts['discharge']},
    'adult-health-check': {
      status: 'out-of-scope',
      recordCount: 0,
      reasonCode: 'SOURCE_NOT_IN_CONTRACT',
    },
    'cancer-screening': {
      status: 'out-of-scope',
      recordCount: 0,
      reasonCode: 'SOURCE_NOT_IN_CONTRACT',
    },
    'hepatitis-bc': {
      status: 'out-of-scope',
      recordCount: 0,
      reasonCode: 'SOURCE_NOT_IN_CONTRACT',
    },
    'ckm-derived': {
      status: 'out-of-scope',
      recordCount: 0,
      reasonCode: 'SOURCE_NOT_IN_CONTRACT',
    },
  };
}

function snapshotFor(revision: number, referenceSuffix: string): SnapshotFixture {
  const records = [
    {
      sourceFamily: 'encounter',
      sourceRef: `sr_snapshot_encounter_${referenceSuffix}`,
      date: '2026-08-14',
      facility: 'Synthetic General Hospital',
      encounterType: 'outpatient',
      diagnosis: {code: 'Z00.0', name: 'Synthetic examination'},
    },
    {
      sourceFamily: 'western-medication',
      sourceRef: `sr_snapshot_western_${referenceSuffix}`,
      date: '2026-08-14',
      facility: 'Synthetic General Hospital',
      medicationName: 'Synthetic tablet',
      ingredient: null,
      dosePerAdministration: 1,
      doseUnit: 'tablet',
      frequency: 'BID',
      days: 7,
    },
    {
      sourceFamily: 'chinese-medication',
      sourceRef: `sr_snapshot_chinese_${referenceSuffix}`,
      date: '2026-08-14',
      facility: 'Synthetic TCM Clinic',
      medicationName: 'Synthetic formula',
      ingredient: null,
      dosePerAdministration: 'source-stated-special',
      doseUnit: 'g',
      frequency: 'TID',
      days: 5,
    },
    {
      sourceFamily: 'allergy',
      sourceRef: `sr_snapshot_allergy_${referenceSuffix}`,
      date: '2026-08-14',
      facility: 'Synthetic General Hospital',
      status: 'present',
      allergen: 'Synthetic allergen',
      reaction: null,
      severity: null,
    },
    {
      sourceFamily: 'lab',
      sourceRef: `sr_snapshot_lab_${referenceSuffix}`,
      date: '2026-08-14',
      facility: 'Synthetic Laboratory',
      itemCode: 'LAB-001',
      itemName: 'Synthetic analyte',
      sourceValue: '12.3',
      normalizedValue: 12.3,
      unit: 'mg/dL',
      sourceReferenceRange: '10-14',
      sourceAbnormalFlag: 'normal',
    },
    {
      sourceFamily: 'imaging',
      sourceRef: `sr_snapshot_imaging_${referenceSuffix}`,
      date: '2026-08-14',
      facility: 'Synthetic Imaging Center',
      examCode: 'IMG-001',
      examName: 'Synthetic scan',
      bodySite: null,
      reportText: null,
    },
    {
      sourceFamily: 'procedure',
      sourceRef: `sr_snapshot_procedure_${referenceSuffix}`,
      date: '2026-08-14',
      facility: 'Synthetic General Hospital',
      procedureCode: 'PROC-001',
      procedureName: 'Synthetic procedure',
      sourceDiagnosis: null,
    },
    {
      sourceFamily: 'discharge',
      sourceRef: `sr_snapshot_discharge_${referenceSuffix}`,
      admissionDate: '2026-08-10',
      dischargeDate: '2026-08-14',
      facility: 'Synthetic General Hospital',
      diagnosis: {code: 'Z00.0', name: 'Synthetic examination'},
      summaryText: null,
    },
  ];
  const recordCounts = Object.fromEntries(
    phaseOneFamilies.map((sourceFamily) => [sourceFamily, 1]),
  );

  return {
    schemaVersion: 'patient-snapshot.v1',
    contractVersion: 'clinical-projection.v1',
    patientId: 'pt_snapshot_patient_0001',
    sessionId: 'ds_snapshot_session_0001',
    revision,
    capturedAt: '2026-08-14T05:30:00.000Z',
    records,
    coverage: coverageFor(recordCounts),
  };
}

describe('sealed Patient Snapshot revisions', () => {
  it('seals one complete terminal revision with only the aeec581 local vault scope', () => {
    const input = snapshotFor(1, 'revision_0000001');
    const sealed = sealVersionedPatientSnapshot(input);

    expect(sealed).not.toBeNull();
    expect(sealed?.snapshot.revision).toBe(1);
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed?.snapshot.records)).toBe(true);
    expect(Object.isFrozen(sealed?.snapshot.records[0])).toBe(true);
    expect(Object.isFrozen(sealed?.snapshot.coverage)).toBe(true);
    expect(sealed?.referenceVault).not.toHaveProperty('patientId');
    expect(sealed?.referenceVault).not.toHaveProperty('rawPayload');
    expect(sealed?.referenceVault).not.toHaveProperty('metadata');
    expect(resolveVaultReference(
      sealed?.referenceVault,
      'sr_snapshot_lab_revision_0000001',
      {sessionId: 'ds_snapshot_session_0001', revision: 1, contractVersion: 'clinical-projection.v1'},
    )).toEqual({sourceFamily: 'lab', recordIndex: 0});

    input.records[0]!['facility'] = 'Changed after seal';
    expect(sealed?.snapshot.records[0]?.facility).toBe('Synthetic General Hospital');
  });

  it('rejects a snapshot before every expected family has a terminal coverage result', () => {
    const incomplete = snapshotFor(1, 'incomplete_0000001');
    Reflect.deleteProperty(incomplete.coverage, 'lab');
    expect(sealVersionedPatientSnapshot(incomplete)).toBeNull();

    const partial = snapshotFor(1, 'partial_000000001');
    partial.records.pop();
    expect(sealVersionedPatientSnapshot(partial)).toBeNull();
  });

  it('accepts an explicit timeout gap without treating it as empty or admitting Phase 2 records', () => {
    const timeout = snapshotFor(1, 'timeout_gap_000001');
    timeout.records = timeout.records.filter(
      (record) => record['sourceFamily'] !== 'lab',
    );
    timeout.coverage['lab'] = {
      status: 'fetch-failure',
      recordCount: 0,
      reasonCode: 'SOURCE_TIMEOUT',
    };
    expect(sealVersionedPatientSnapshot(timeout)?.snapshot.coverage.lab).toEqual({
      status: 'fetch-failure', recordCount: 0, reasonCode: 'SOURCE_TIMEOUT',
    });

    const phaseTwo = snapshotFor(1, 'phase_two_00000001');
    phaseTwo.records.push({
      sourceFamily: 'adult-health-check',
      sourceRef: 'sr_snapshot_phase_two_0001',
      date: '2026-08-14',
    });
    expect(sealVersionedPatientSnapshot(phaseTwo)).toBeNull();
  });

  it('requires a monotonic revision and freshly scoped references for a reseal', () => {
    const first = sealVersionedPatientSnapshot(snapshotFor(1, 'revision_0000001'));
    expect(first).not.toBeNull();

    expect(
      sealVersionedPatientSnapshot(snapshotFor(1, 'revision_0000001'), first),
    ).toBeNull();
    expect(
      sealVersionedPatientSnapshot(snapshotFor(2, 'revision_0000001'), first),
    ).toBeNull();

    const second = sealVersionedPatientSnapshot(
      snapshotFor(2, 'revision_0000002'),
      first,
    );
    expect(second?.snapshot.revision).toBe(2);
    expect(resolveVaultReference(
      first?.referenceVault,
      'sr_snapshot_lab_revision_0000002',
      {sessionId: 'ds_snapshot_session_0001', revision: 2, contractVersion: 'clinical-projection.v1'},
    )).toBeNull();
  });

  it('rejects mutations of the sealed snapshot and a forged prior vault', () => {
    const sealed = sealVersionedPatientSnapshot(snapshotFor(1, 'mutation_00000001'));
    expect(sealed).not.toBeNull();
    expect(() => {
      (sealed!.snapshot.records[0] as {facility: string}).facility = 'must reject';
    }).toThrow(TypeError);

    const forgedPrior = {
      snapshot: sealed!.snapshot,
      referenceVault: {
        ...sealed!.referenceVault,
        entries: sealed!.referenceVault.entries.slice(1),
      },
    };
    expect(
      sealVersionedPatientSnapshot(snapshotFor(2, 'mutation_00000002'), forgedPrior),
    ).toBeNull();
  });
});
