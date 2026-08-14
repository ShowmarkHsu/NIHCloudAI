import fullSpectrum from '../../fixtures/clinical/full-spectrum.json';
import emptyAndDenied from '../../fixtures/clinical/empty-and-denied.json';
import patientSwitchRace from '../../fixtures/clinical/patient-switch-race.json';
import sparseAndMalformed from '../../fixtures/clinical/sparse-and-malformed.json';
import boundaryClock from '../../fixtures/clinical/boundary-clock.json';
import settingsExtremes from '../../fixtures/clinical/settings-extremes.json';

export const fixtures = new Map([
  [fullSpectrum.id, fullSpectrum],
  [emptyAndDenied.id, emptyAndDenied],
  [patientSwitchRace.id, patientSwitchRace],
  [sparseAndMalformed.id, sparseAndMalformed],
  [boundaryClock.id, boundaryClock],
  [settingsExtremes.id, settingsExtremes],
]);

const sourceGlobals = new Map([
  ['western-medication', 'lastInterceptedMedicationData'],
  ['chronic-refill', 'lastInterceptedChronicMedData'],
  ['medication-days', 'lastInterceptedMedDaysData'],
  ['chinese-medication', 'lastInterceptedChineseMedData'],
  ['lab', 'lastInterceptedLabData'],
  ['imaging', 'lastInterceptedImagingData'],
  ['allergy', 'lastInterceptedAllergyData'],
  ['surgery', 'lastInterceptedSurgeryData'],
  ['discharge', 'lastInterceptedDischargeData'],
  ['patient-summary', 'lastInterceptedPatientSummaryData'],
  ['adult-health-check', 'lastInterceptedAdultHealthCheckData'],
  ['cancer-screening', 'lastInterceptedCancerScreeningData'],
  ['hepatitis', 'lastInterceptedHbcvdata'],
]);

function isoToRoc(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return year ? `${Number(year) - 1911}/${month}/${day}` : '';
}

function transformRecord(source, record) {
  if (source === 'western-medication') {
    const syntheticAtc7 = new Map([
      ['SGLT2', 'A10BK01'],
      ['ARB', 'C09CA01'],
      ['STATIN', 'C10AA01'],
      ['NSAID', 'M01AE01'],
    ]);
    return {
      ...record,
      drug_date: record.drug_date?.replaceAll('-', '/'),
      hosp: `${String(record.hosp || 'SYNTHETIC FACILITY').split(';')[0]};${record.func_type || '門診'}`,
      drug_ename: record.drug_ename || record.drug_code || 'SYNTHETIC MEDICATION',
      icd_code: record.icd_code || 'Z00',
      icd_cname: record.icd_cname || 'SYNTHETIC DIAGNOSIS',
      qty: record.order_qty || record.order_drug_day || '1',
      day: record.order_drug_day || record.day || '1',
      drug_atc7_code: record.drug_atc7_code || syntheticAtc7.get(record.drug_atc5_name) || `SYN-${record.drug_atc5_name || 'ATC'}-01`,
      drug_left: record.drug_left || '1',
    };
  }
  if (source === 'chinese-medication') {
    return {
      ...record,
      func_date: `${record.drug_date}T00:00:00+08:00`,
      hosp: `${String(record.hosp || 'SYNTHETIC TCM').split(';')[0]};門診;SYN`,
      cdrug_name: record.drug_perscrn_name,
      cdrug_sosc_name: record.sosc_name,
      cdrug_dose_name: 'SYNTHETIC GRANULE',
    };
  }
  if (source === 'lab') {
    const ckmNames = new Map([
      ['09040C', 'SYNTHETIC CKM CODE (UPCR)'],
      ['12111C', 'SYNTHETIC CKM CODE (UACR)'],
    ]);
    const itemName = ckmNames.get(record.order_code) || record.assay_item_name || record.order_code || 'SYNTHETIC LAB ITEM';
    return {
      ...record,
      real_inspect_date: record.inspect_date?.replaceAll('-', '/'),
      hosp: `${String(record.hosp || 'SYNTHETIC LAB').split(';')[0]};門診`,
      icd_code: 'Z03',
      icd_cname: 'SYNTHETIC LAB DIAGNOSIS',
      unit_data: record.unit,
      consult_value: record.ref_value,
      assay_tp_cname: record.assay_tp_cname || '生化學檢查',
      assay_item_name: itemName,
      order_name: record.order_name || itemName,
      assay_method: 'SYNTHETIC METHOD',
    };
  }
  if (source === 'imaging') {
    const hasReport = Boolean(record.report);
    return {
      ...record,
      order_name: record.order_code?.startsWith('SYN-')
        ? `${record.order_name || 'SYNTHETIC IMAGE'} ${record.order_code}`
        : record.order_name,
      real_inspect_date: record.inspect_date?.replaceAll('-', '/'),
      hosp: `${String(record.hosp || 'SYNTHETIC IMAGING').split(';')[0]};門診`,
      inspect_result: record.report || '',
      path_diag_2: '',
      path_diag_3: '',
      cure_path_name: 'SYNTHETIC REGION',
      ipl_case_seq_no: hasReport ? '' : `SYN-${record.order_code || 'IMAGE'}`,
      ctmri_mark: hasReport ? '' : 'Y',
      read_pos: '2',
      file_type: 'DCF',
      file_qty: '1',
    };
  }
  if (source === 'allergy') {
    return {
      ...record,
      upload_d: isoToRoc(record.record_date),
      sympton_name: `${record.symptom || 'SYNTHETIC REACTION'};`,
      allerg_severity_level: 'SYNTHETIC LEVEL',
    };
  }
  if (source === 'surgery') {
    return {
      ...record,
      exe_s_date: `${record.func_date}T00:00:00+08:00`,
      icd_code: 'Z04',
      icd_cname: record.order_name || 'SYNTHETIC PROCEDURE DIAGNOSIS',
    };
  }
  if (source === 'discharge') {
    return {
      ...record,
      in_date: record.admission_date,
      out_date: record.discharge_date,
      icd_code: 'Z05',
      icd_cname: record.diagnosis,
      mds_file: '',
      mds_pdf_file: '',
    };
  }
  if (source === 'medication-days') {
    return {
      robject: [{
        ingredient: `${record.drug_code || 'SYNTHETIC MEDICATION'}，SYNTHETIC DETAIL`,
        pres_med_day: record.drug_left || '3',
        edate: record.calculate_date?.replaceAll('-', '/') || '2026/07/03',
      }],
    };
  }
  if (source === 'patient-summary') {
    return {...record, txt: record.summary_text, img: ''};
  }
  if (source === 'adult-health-check') {
    const first = record.result_data?.[0] || {};
    return {
      ...record,
      result_data: [{
        title: `${first.item || 'SYNTHETIC CHECK'} ${first.value || ''}`.trim(),
        height: first.value || '--',
      }],
    };
  }
  if (source === 'cancer-screening') {
    const typeMap = new Map([
      ['COLORECTAL', 'colorectal'],
      ['ORAL', 'oralMucosa'],
      ['CERVICAL', 'papSmears'],
      ['BREAST', 'mammography'],
    ]);
    return (record.result_data || []).reduce((mapped, item) => {
      const type = [...typeMap].find(([token]) => item.screening_type?.includes(token))?.[1];
      if (type) {
        mapped[type] = {subData: [{result: item.result, func_date: item.date, hosp_abbr: 'SYNTHETIC'}]};
      }
      return mapped;
    }, {});
  }
  if (source === 'hepatitis') {
    return {
      ...record,
      result_data: (record.result_data || []).map((item) => ({
        assay_item_name: item.item,
        assay_value: item.result,
        real_inspect_date: item.date,
        consult_value: '',
      })),
    };
  }
  return record;
}

function variantValues(fixture, variantId) {
  return fixture.settingsVariants?.find(({id}) => id === variantId)?.values || {};
}

function toChromeSettings(values) {
  const mapped = {...values};
  if ('showChineseDiagnosis' in values) mapped.chineseMedShowDiagnosis = values.showChineseDiagnosis;
  if ('showEffectName' in values) mapped.chineseMedShowEffectName = values.showEffectName;
  if ('showUnit' in values) mapped.showLabUnit = values.showUnit;
  if ('showReference' in values) mapped.showLabReference = values.showReference;
  if ('highlightAbnormal' in values) mapped.highlightAbnormalLab = values.highlightAbnormal;
  if ('enableAdultHealthCheck' in values) mapped.fetchAdultHealthCheck = values.enableAdultHealthCheck;
  if ('enableCancerScreening' in values) mapped.fetchCancerScreening = values.enableCancerScreening;
  if ('enableHepatitisData' in values) mapped.fetchHbcvdata = values.enableHepatitisData;
  if (Array.isArray(values.trackedLabs)) {
    mapped.focusedLabTests = values.trackedLabs.map((orderCode) => ({
      orderCode,
      displayName: orderCode,
      enabled: true,
    }));
  }
  if (Array.isArray(values.atcGroups)) delete mapped.atcGroups;
  delete mapped.trackedLabs;
  delete mapped.customMedicationCopy;
  delete mapped.customLabCopy;
  return mapped;
}

function replayActiveSession(fixture) {
  const accepted = new Set(fixture.expected.acceptedEventSeq);
  const expectedRejected = new Set(fixture.expected.rejectedEventSeq);
  const acceptedSeq = [];
  const rejectedSeq = [];
  const latestEvents = new Map();
  let activeSessionId = null;
  let activePatientKey = null;

  for (const event of [...fixture.events].sort((left, right) => left.seq - right.seq)) {
    if (event.type === 'session-start') {
      activeSessionId = event.sessionId;
      activePatientKey = event.patientKey;
      latestEvents.clear();
      acceptedSeq.push(event.seq);
      continue;
    }
    if (event.type !== 'source-result') continue;
    const belongsToActiveSession = event.sessionId === activeSessionId && event.patientKey === activePatientKey;
    if (!belongsToActiveSession) {
      rejectedSeq.push(event.seq);
      continue;
    }
    acceptedSeq.push(event.seq);
    latestEvents.set(event.source, event);
  }

  const actualAccepted = new Set(acceptedSeq);
  if ([...accepted].some((seq) => !actualAccepted.has(seq)) || [...expectedRejected].some((seq) => !rejectedSeq.includes(seq))) {
    throw new Error(`Fixture replay diverged from expected event contract: ${fixture.id}`);
  }
  if (activeSessionId !== fixture.expected.activeSessionId || activePatientKey !== fixture.expected.activePatientKey) {
    throw new Error(`Fixture replay selected the wrong active session: ${fixture.id}`);
  }
  return {latestEvents, acceptedSeq, rejectedSeq, activeSessionId, activePatientKey};
}

export function installFixture(fixtureId, variantId, settingsFixtureId = fixtureId) {
  const fixture = fixtures.get(fixtureId);
  const settingsFixture = fixtures.get(settingsFixtureId);
  if (!fixture || fixture.synthetic !== true) throw new Error(`Synthetic fixture required: ${fixtureId}`);
  if (!settingsFixture || settingsFixture.synthetic !== true) throw new Error(`Synthetic settings fixture required: ${settingsFixtureId}`);

  const replay = replayActiveSession(fixture);
  const {latestEvents} = replay;

  const sourceStates = {};
  for (const [source, globalName] of sourceGlobals) {
    const event = latestEvents.get(source);
    const records = event?.status === 'has-data' ? (event.body?.rObject || []) : [];
    sourceStates[source] = {
      status: event?.status || 'confirmed-empty',
      count: records.length,
    };
    window[globalName] = {rObject: records.map((record) => transformRecord(source, record))};
  }

  const identityEvent = latestEvents.get('patient-identity');
  const identityRecords = identityEvent?.status === 'has-data' ? (identityEvent.body?.rObject || []) : [];
  sourceStates['patient-identity'] = {
    status: identityEvent?.status || 'confirmed-empty',
    count: identityRecords.length,
  };
  const identityLabel = identityRecords[0]?.displayLabel || 'SYNTHETIC SUBJECT';
  window._localUserInfo = {
    name: identityLabel,
    userId: 'SYNTHETIC-ID',
    gender: 'X',
    birthday: '1000101',
  };

  return {
    fixture,
    sourceStates,
    replay,
    settings: toChromeSettings(variantValues(settingsFixture, variantId)),
  };
}

export function installFixedClock(isoTimestamp) {
  const NativeDate = globalThis.Date;
  const fixedNow = NativeDate.parse(isoTimestamp);
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }

    static now() {
      return fixedNow;
    }
  }
  globalThis.Date = FixedDate;
}
