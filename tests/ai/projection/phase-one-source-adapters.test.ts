import { describe, expect, it } from 'vitest';

import { resolveVaultReference } from '../../../src/ai/contracts/referenceVault';
import { createProjectionReferenceVault } from '../../../src/ai/projection/builder';
import { projectAllergySourceFamily } from '../../../src/ai/projection/sources/allergy';
import { projectEncounterSourceFamily } from '../../../src/ai/projection/sources/encounter';
import {
  projectChineseMedicationSourceFamily,
  projectWesternMedicationSourceFamily,
} from '../../../src/ai/projection/sources/medication';

const knownDirectIdentifiers = ['Synthetic Patient'];
const vaultScope = {
  sessionId: 'ds_synthetic_adapter_0001',
  revision: 1,
  contractVersion: 'clinical-projection.v1',
};

function sourceReferences(...values: string[]): () => unknown {
  let index = 0;
  return () => values[index++];
}

const encounterInput = [{
  date: '2026-08-14',
  facility: 'Synthetic Clinic',
  encounterType: 'outpatient',
  diagnosisCode: 'Z00.0',
  diagnosisName: 'Synthetic examination',
}];

const medicationInput = [{
  date: '2026-08-14',
  facility: 'Synthetic Clinic',
  medicationName: 'Synthetic tablet',
  ingredient: 'Synthetic ingredient',
  dosePerAdministration: 1,
  doseUnit: 'tablet',
  frequency: 'BID',
  days: 7,
}];

const allergyInput = [{
  date: '2026-08-14',
  facility: 'Synthetic Clinic',
  status: 'present',
  allergen: 'Synthetic allergen',
  reaction: 'Synthetic rash',
  severity: null,
}];

describe('B3 pure Phase 1 source adapters', () => {
  it('projects only explicit normalized encounter, medication, and allergy fields', () => {
    const encounter = projectEncounterSourceFamily(
      encounterInput,
      [],
      sourceReferences('sr_adapter_encounter_000001'),
    );
    const western = projectWesternMedicationSourceFamily(
      medicationInput,
      [],
      sourceReferences('sr_adapter_western_0000001'),
    );
    const chinese = projectChineseMedicationSourceFamily(
      [{
        date: '2026-08-13',
        facility: 'Synthetic TCM Clinic',
        medicationName: 'Synthetic formula',
        ingredient: null,
        dosePerAdministration: 'source-stated-special',
        doseUnit: 'g',
        frequency: 'TID',
        days: 5,
      }],
      [],
      sourceReferences('sr_adapter_chinese_0000001'),
    );
    const allergy = projectAllergySourceFamily(
      allergyInput,
      [],
      sourceReferences('sr_adapter_allergy_00000001'),
    );

    for (const result of [encounter, western, chinese, allergy]) {
      expect(result.status).toBe('accepted');
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.records)).toBe(true);
    }
    expect(encounter.records[0]).toEqual({
      sourceFamily: 'encounter', sourceRef: 'sr_adapter_encounter_000001',
      date: '2026-08-14', facility: 'Synthetic Clinic', encounterType: 'outpatient',
      diagnosis: {code: 'Z00.0', name: 'Synthetic examination'},
    });
    expect(western.records[0]?.sourceFamily).toBe('western-medication');
    expect(chinese.records[0]).toMatchObject({
      sourceFamily: 'chinese-medication', dosePerAdministration: 'source-stated-special',
    });
    expect(allergy.records[0]).toMatchObject({status: 'present', allergen: 'Synthetic allergen'});
  });

  it('does not derive encounters from medication records', () => {
    expect(
      projectEncounterSourceFamily(
        medicationInput,
        knownDirectIdentifiers,
        sourceReferences('sr_adapter_encounter_000001'),
      ),
    ).toEqual({
      status: 'quarantined', sourceFamily: 'encounter', records: [],
      reasonCode: 'SOURCE_SCHEMA_REJECTED',
    });
  });

  it('keeps explicit allergy absence distinct from an empty source result', () => {
    const explicitAbsence = projectAllergySourceFamily(
      [{date: '2026-08-14', facility: 'Synthetic Clinic', status: 'no-known-allergy'}],
      [],
      sourceReferences('sr_adapter_allergy_absence01'),
    );
    const noRecords = projectAllergySourceFamily([], [], sourceReferences());

    expect(explicitAbsence).toMatchObject({status: 'accepted', sourceFamily: 'allergy'});
    expect(explicitAbsence.records[0]).toMatchObject({status: 'no-known-allergy'});
    expect(noRecords).toEqual({status: 'accepted', sourceFamily: 'allergy', records: []});
  });

  it('quarantines every family for unknown, missing, wrong-type, identity-tainted, or illegal text', () => {
    const cases = [
      {
        sourceFamily: 'encounter',
        project: projectEncounterSourceFamily,
        input: encounterInput,
        extra: 'unexpectedField',
        missing: 'diagnosisName',
        wrong: 'encounterType',
        tainted: 'facility',
        illegal: 'diagnosisName',
      },
      {
        sourceFamily: 'western-medication',
        project: projectWesternMedicationSourceFamily,
        input: medicationInput,
        extra: 'unexpectedField',
        missing: 'medicationName',
        wrong: 'days',
        tainted: 'facility',
        illegal: 'medicationName',
      },
      {
        sourceFamily: 'chinese-medication',
        project: projectChineseMedicationSourceFamily,
        input: medicationInput,
        extra: 'unexpectedField',
        missing: 'medicationName',
        wrong: 'days',
        tainted: 'facility',
        illegal: 'medicationName',
      },
      {
        sourceFamily: 'allergy',
        project: projectAllergySourceFamily,
        input: allergyInput,
        extra: 'unexpectedField',
        missing: 'allergen',
        wrong: 'status',
        tainted: 'facility',
        illegal: 'allergen',
      },
    ] as const;

    for (const testCase of cases) {
      const extra = structuredClone(testCase.input);
      Reflect.set(extra[0]!, testCase.extra, 'must-not-pass-through');
      const missing = structuredClone(testCase.input);
      Reflect.deleteProperty(missing[0]!, testCase.missing);
      const wrong = structuredClone(testCase.input);
      Reflect.set(wrong[0]!, testCase.wrong, 'wrong-type');
      const tainted = structuredClone(testCase.input);
      Reflect.set(tainted[0]!, testCase.tainted, 'Synthetic Patient');
      const illegal = structuredClone(testCase.input);
      Reflect.set(illegal[0]!, testCase.illegal, '<b>noncanonical text</b>');
      const mixed = [testCase.input[0]!, extra[0]!];

      for (const [input, reasonCode] of [
        [extra, 'SOURCE_SCHEMA_REJECTED'],
        [missing, 'SOURCE_SCHEMA_REJECTED'],
        [wrong, 'SOURCE_SCHEMA_REJECTED'],
        [tainted, 'SOURCE_IDENTITY_TAINT'],
        [illegal, 'SOURCE_TEXT_SANITIZATION_FAILED'],
        [mixed, 'SOURCE_SCHEMA_REJECTED'],
      ] as const) {
        expect(testCase.project(input, knownDirectIdentifiers, sourceReferences('sr_adapter_negative_000001'))).toEqual({
          status: 'quarantined', sourceFamily: testCase.sourceFamily, records: [], reasonCode,
        });
      }
    }
  });

  it('rejects an overlength field or identity-encoded source reference for the whole family', () => {
    const overlength = structuredClone(medicationInput);
    Reflect.set(overlength[0]!, 'medicationName', 'x'.repeat(257));
    expect(
      projectWesternMedicationSourceFamily(
        overlength,
        knownDirectIdentifiers,
        sourceReferences('sr_adapter_overlength_00001'),
      ),
    ).toMatchObject({status: 'quarantined', sourceFamily: 'western-medication', records: []});

    expect(
      projectAllergySourceFamily(
        allergyInput,
        knownDirectIdentifiers,
        sourceReferences('sr_patient_encoded_000001'),
      ),
    ).toEqual({
      status: 'quarantined', sourceFamily: 'allergy', records: [],
      reasonCode: 'SOURCE_SCHEMA_REJECTED',
    });
  });

  it('rejects duplicate opaque references rather than returning a partial medication family', () => {
    const twoRecords = [medicationInput[0]!, medicationInput[0]!];
    expect(
      projectWesternMedicationSourceFamily(
        twoRecords,
        [],
        sourceReferences('sr_adapter_duplicate_000001', 'sr_adapter_duplicate_000001'),
      ),
    ).toEqual({
      status: 'quarantined', sourceFamily: 'western-medication', records: [],
      reasonCode: 'SOURCE_SCHEMA_REJECTED',
    });
  });

  it('builds the aeec581 local reference-vault contract without raw or patient state', () => {
    const encounter = projectEncounterSourceFamily(
      encounterInput,
      [],
      sourceReferences('sr_adapter_encounter_000001'),
    );
    const western = projectWesternMedicationSourceFamily(
      medicationInput,
      [],
      sourceReferences('sr_adapter_western_0000001'),
    );
    expect(encounter.status).toBe('accepted');
    expect(western.status).toBe('accepted');
    const vault = createProjectionReferenceVault(vaultScope, [...encounter.records, ...western.records]);

    expect(vault).not.toBeNull();
    expect(vault).not.toHaveProperty('patientId');
    expect(vault).not.toHaveProperty('rawPayload');
    expect(vault).not.toHaveProperty('metadata');
    expect(resolveVaultReference(vault, 'sr_adapter_western_0000001', vaultScope)).toEqual({
      sourceFamily: 'western-medication', recordIndex: 0,
    });
    expect(resolveVaultReference(vault, 'sr_adapter_western_0000001', {
      sessionId: 'ds_synthetic_adapter_0001', revision: 2, contractVersion: 'clinical-projection.v1',
    })).toBeNull();
  });
});
