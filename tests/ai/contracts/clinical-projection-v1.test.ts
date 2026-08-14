import { describe, expect, it } from 'vitest';

import {
  clinicalProjectionV1Schema,
  phaseOneSourceRecordSchema,
} from '../../../src/ai/contracts/clinicalProjection';
import {
  phaseOneCoverageSchema,
  phaseTwoCoverageSchema,
  snapshotCoverageSchema,
} from '../../../src/ai/contracts/coverage';
import {
  patientDisplayIdentityV1Schema,
  patientSnapshotV1Schema,
  type PatientSnapshotV1,
} from '../../../src/ai/contracts/patientSnapshot';
import {
  CLINICAL_PROJECTION_CONTRACT_VERSION,
  PATIENT_DISPLAY_IDENTITY_SCHEMA_VERSION,
  PATIENT_SNAPSHOT_SCHEMA_VERSION,
  clinicalProjectionContractVersionSchema,
} from '../../../src/ai/contracts/versions';

const validRecords = [
  {
    sourceFamily: 'encounter',
    sourceRef: 'sr_encounter_00000001',
    date: '2026-08-14',
    facility: 'Synthetic General Hospital',
    encounterType: 'outpatient',
    diagnosis: { code: 'Z00.0', name: 'Synthetic examination' },
  },
  {
    sourceFamily: 'western-medication',
    sourceRef: 'sr_western_medication_0001',
    date: '2026-08-14',
    facility: 'Synthetic General Hospital',
    medicationName: 'Example tablet',
    ingredient: 'Example ingredient',
    dosePerAdministration: 0.5,
    doseUnit: 'tablet',
    frequency: 'BID',
    days: 7,
  },
  {
    sourceFamily: 'chinese-medication',
    sourceRef: 'sr_chinese_medication_0001',
    date: '2026-08-14',
    facility: 'Synthetic Chinese Medicine Clinic',
    medicationName: 'Example formula',
    ingredient: null,
    dosePerAdministration: 'source-stated-special',
    doseUnit: 'g',
    frequency: 'TID',
    days: 5,
  },
  {
    sourceFamily: 'allergy',
    sourceRef: 'sr_allergy_0000000001',
    date: '2026-08-14',
    facility: 'Synthetic General Hospital',
    status: 'present',
    allergen: 'Example allergen',
    reaction: 'Example rash',
    severity: null,
  },
  {
    sourceFamily: 'lab',
    sourceRef: 'sr_lab_000000000000001',
    date: '2026-08-14',
    facility: 'Synthetic Laboratory',
    itemCode: 'LAB-001',
    itemName: 'Example analyte',
    sourceValue: '12.3',
    normalizedValue: 12.3,
    unit: 'mg/dL',
    sourceReferenceRange: '10-14',
    sourceAbnormalFlag: 'normal',
  },
  {
    sourceFamily: 'imaging',
    sourceRef: 'sr_imaging_000000001',
    date: '2026-08-14',
    facility: 'Synthetic Imaging Center',
    examCode: 'IMG-001',
    examName: 'Example scan',
    bodySite: 'Example site',
    reportText: 'De-identified synthetic report.',
  },
  {
    sourceFamily: 'procedure',
    sourceRef: 'sr_procedure_00000001',
    date: '2026-08-14',
    facility: 'Synthetic General Hospital',
    procedureCode: 'PROC-001',
    procedureName: 'Example procedure',
    sourceDiagnosis: { code: null, name: 'Synthetic indication' },
  },
  {
    sourceFamily: 'discharge',
    sourceRef: 'sr_discharge_00000001',
    admissionDate: '2026-08-10',
    dischargeDate: '2026-08-14',
    facility: 'Synthetic General Hospital',
    diagnosis: { code: 'Z00.0', name: 'Synthetic examination' },
    summaryText: 'De-identified synthetic discharge summary.',
  },
];

const fullCoverage = {
  encounter: { status: 'has-data', recordCount: 1 },
  'western-medication': { status: 'has-data', recordCount: 1 },
  'chinese-medication': { status: 'has-data', recordCount: 1 },
  allergy: { status: 'has-data', recordCount: 1 },
  lab: { status: 'has-data', recordCount: 1 },
  imaging: { status: 'has-data', recordCount: 1 },
  procedure: { status: 'has-data', recordCount: 1 },
  discharge: { status: 'has-data', recordCount: 1 },
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

const validProjection = {
  contractVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
  records: validRecords,
  coverage: fullCoverage,
};

const validSnapshot = {
  schemaVersion: PATIENT_SNAPSHOT_SCHEMA_VERSION,
  contractVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
  patientId: 'pt_opaque_patient_0001',
  sessionId: 'ds_opaque_session_0001',
  revision: 1,
  capturedAt: '2026-08-14T05:30:00.000Z',
  records: validRecords,
  coverage: fullCoverage,
};

describe('clinical-projection.v1', () => {
  it('accepts only the exact contract version', () => {
    expect(
      clinicalProjectionContractVersionSchema.parse(
        CLINICAL_PROJECTION_CONTRACT_VERSION,
      ),
    ).toBe('clinical-projection.v1');

    for (const invalidVersion of [
      'clinical-projection.v2',
      '^clinical-projection.v1',
      '>=clinical-projection.v1',
      1,
    ]) {
      expect(
        clinicalProjectionContractVersionSchema.safeParse(invalidVersion)
          .success,
      ).toBe(false);
    }
  });

  it('accepts every closed Phase 1 source record contract', () => {
    for (const record of validRecords) {
      expect(phaseOneSourceRecordSchema.safeParse(record).success).toBe(true);
    }
  });

  it('strictly rejects unknown, missing, wrong-type, and extra record fields', () => {
    for (const record of validRecords) {
      const withExtraField = structuredClone(record);
      Reflect.set(withExtraField, 'unexpectedField', 'must-not-pass-through');
      expect(phaseOneSourceRecordSchema.safeParse(withExtraField).success).toBe(
        false,
      );

      const missingField = structuredClone(record);
      Reflect.deleteProperty(missingField, 'sourceRef');
      expect(phaseOneSourceRecordSchema.safeParse(missingField).success).toBe(
        false,
      );

      const wrongType = structuredClone(record);
      Reflect.set(wrongType, 'sourceRef', 1234);
      expect(phaseOneSourceRecordSchema.safeParse(wrongType).success).toBe(
        false,
      );
    }
  });

  it('rejects every Phase 2 source as a record', () => {
    for (const sourceFamily of [
      'adult-health-check',
      'cancer-screening',
      'hepatitis-bc',
      'ckm-derived',
    ]) {
      expect(
        phaseOneSourceRecordSchema.safeParse({
          sourceFamily,
          sourceRef: 'sr_phase_two_00000001',
          date: '2026-08-14',
        }).success,
      ).toBe(false);
    }
  });

  it('accepts all six terminal coverage states without coercion', () => {
    const phaseOneStates = [
      { status: 'has-data', recordCount: 1 },
      { status: 'confirmed-empty', recordCount: 0 },
      {
        status: 'unauthorized',
        recordCount: 0,
        reasonCode: 'SOURCE_UNAUTHORIZED',
      },
      {
        status: 'fetch-failure',
        recordCount: 0,
        reasonCode: 'SOURCE_TIMEOUT',
      },
      {
        status: 'normalization-failure',
        recordCount: 0,
        reasonCode: 'SOURCE_IDENTITY_TAINT',
      },
    ];

    for (const state of phaseOneStates) {
      expect(phaseOneCoverageSchema.safeParse(state).success).toBe(true);
    }
    expect(
      phaseTwoCoverageSchema.safeParse({
        status: 'out-of-scope',
        recordCount: 0,
        reasonCode: 'SOURCE_NOT_IN_CONTRACT',
      }).success,
    ).toBe(true);
    expect(
      phaseOneCoverageSchema.safeParse({
        status: 'confirmed-empty',
        recordCount: '0',
      }).success,
    ).toBe(false);
  });

  it('requires all exact coverage keys and rejects unsafe error data', () => {
    expect(snapshotCoverageSchema.safeParse(fullCoverage).success).toBe(true);

    const missingFamily = structuredClone(fullCoverage);
    Reflect.deleteProperty(missingFamily, 'lab');
    expect(snapshotCoverageSchema.safeParse(missingFamily).success).toBe(false);

    const unknownFamily = structuredClone(fullCoverage);
    Reflect.set(unknownFamily, 'other', {
      status: 'confirmed-empty',
      recordCount: 0,
    });
    expect(snapshotCoverageSchema.safeParse(unknownFamily).success).toBe(false);

    expect(
      phaseOneCoverageSchema.safeParse({
        status: 'fetch-failure',
        recordCount: 0,
        reasonCode: 'patient A123456789 failed',
      }).success,
    ).toBe(false);
  });

  it('rejects mismatched coverage counts and duplicate source references', () => {
    const mismatchedCoverage = structuredClone(validProjection);
    mismatchedCoverage.coverage.encounter.recordCount = 2;
    expect(clinicalProjectionV1Schema.safeParse(mismatchedCoverage).success).toBe(
      false,
    );

    const duplicateReference = structuredClone(validProjection);
    duplicateReference.records[1]!.sourceRef =
      duplicateReference.records[0]!.sourceRef;
    expect(clinicalProjectionV1Schema.safeParse(duplicateReference).success).toBe(
      false,
    );
  });

  it('rejects identity taint and uncontracted facts/provider/error containers', () => {
    for (const taintedField of [
      'displayIdentity',
      'patientId',
      'patientName',
      'nationalId',
      'birthDate',
      'medicalRecordNumber',
      'cardNumber',
      'token',
      'fileUrl',
    ]) {
      const taintedRecord = structuredClone(validRecords[0]!);
      Reflect.set(taintedRecord, taintedField, 'direct-identifier');
      expect(phaseOneSourceRecordSchema.safeParse(taintedRecord).success).toBe(
        false,
      );

      const taintedSnapshot = structuredClone(validSnapshot);
      Reflect.set(taintedSnapshot, taintedField, 'direct-identifier');
      expect(patientSnapshotV1Schema.safeParse(taintedSnapshot).success).toBe(
        false,
      );

      const taintedCoverage = structuredClone(fullCoverage);
      Reflect.set(
        taintedCoverage.encounter,
        taintedField,
        'direct-identifier',
      );
      expect(snapshotCoverageSchema.safeParse(taintedCoverage).success).toBe(
        false,
      );
    }

    for (const uncontractedContainer of [
      'facts',
      'providerPayload',
      'errors',
      'metadata',
      'other',
    ]) {
      const invalidProjection = structuredClone(validProjection);
      Reflect.set(invalidProjection, uncontractedContainer, []);
      expect(clinicalProjectionV1Schema.safeParse(invalidProjection).success).toBe(
        false,
      );
    }
  });
});

describe('Patient Snapshot v1 and display identity separation', () => {
  it('keeps display identity in its own strict local-only contract', () => {
    const displayIdentity = patientDisplayIdentityV1Schema.parse({
      schemaVersion: PATIENT_DISPLAY_IDENTITY_SCHEMA_VERSION,
      displayName: 'Synthetic Patient',
      nationalId: 'SYNTHETIC-ID',
      birthDate: '2000-01-01',
      medicalRecordNumber: 'SYNTHETIC-MRN',
      cardNumber: null,
    });

    expect(displayIdentity.displayName).toBe('Synthetic Patient');
    expect(Object.isFrozen(displayIdentity)).toBe(true);
    expect('displayIdentity' in validSnapshot).toBe(false);
    expect(
      patientDisplayIdentityV1Schema.safeParse({
        schemaVersion: PATIENT_DISPLAY_IDENTITY_SCHEMA_VERSION,
        displayName: 'Synthetic Patient',
        nationalId: null,
        birthDate: null,
        medicalRecordNumber: null,
        cardNumber: null,
        token: 'must-not-be-identity-state',
      }).success,
    ).toBe(false);
  });

  it('parses a closed immutable snapshot and freezes nested contract data', () => {
    const snapshot = patientSnapshotV1Schema.parse(validSnapshot);

    expect(snapshot.contractVersion).toBe('clinical-projection.v1');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.records)).toBe(true);
    expect(Object.isFrozen(snapshot.records[0])).toBe(true);
    expect(Object.isFrozen(snapshot.coverage)).toBe(true);
    expect(Object.isFrozen(snapshot.coverage.encounter)).toBe(true);
  });

  it('rejects missing, wrong-type, extra, and inexact snapshot fields', () => {
    const missingRevision = structuredClone(validSnapshot);
    Reflect.deleteProperty(missingRevision, 'revision');
    expect(patientSnapshotV1Schema.safeParse(missingRevision).success).toBe(false);

    const coercedRevision = structuredClone(validSnapshot);
    Reflect.set(coercedRevision, 'revision', '1');
    expect(patientSnapshotV1Schema.safeParse(coercedRevision).success).toBe(false);

    const extraField = structuredClone(validSnapshot);
    Reflect.set(extraField, 'metadata', {});
    expect(patientSnapshotV1Schema.safeParse(extraField).success).toBe(false);

    const versionRange = structuredClone(validSnapshot);
    Reflect.set(versionRange, 'contractVersion', '^clinical-projection.v1');
    expect(patientSnapshotV1Schema.safeParse(versionRange).success).toBe(false);

    const malformedTimestamp = structuredClone(validSnapshot);
    Reflect.set(malformedTimestamp, 'capturedAt', '2026-08-14');
    expect(patientSnapshotV1Schema.safeParse(malformedTimestamp).success).toBe(
      false,
    );

    expect(
      patientDisplayIdentityV1Schema.safeParse({
        schemaVersion: PATIENT_DISPLAY_IDENTITY_SCHEMA_VERSION,
        displayName: 'Synthetic Patient',
        nationalId: null,
        birthDate: '2026-99-99',
        medicalRecordNumber: null,
        cardNumber: null,
      }).success,
    ).toBe(false);
  });
});

function assertImmutableSnapshotTyping(snapshot: PatientSnapshotV1): void {
  // @ts-expect-error Patient Snapshot properties are immutable.
  snapshot.revision = 2;
  // @ts-expect-error Patient Snapshot records are immutable.
  snapshot.records.push(snapshot.records[0]!);
  // @ts-expect-error Source records are immutable.
  snapshot.records[0]!.sourceRef = 'replacement-ref';
  // @ts-expect-error Coverage entries are immutable.
  snapshot.coverage.encounter.recordCount = 99;
}

void assertImmutableSnapshotTyping;
