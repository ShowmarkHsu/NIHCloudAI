import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const FIXTURE_DIRECTORY = fileURLToPath(new URL('../fixtures/clinical/', import.meta.url));
const REQUIRED_FIXTURES = Object.freeze([
  'boundary-clock',
  'empty-and-denied',
  'full-spectrum',
  'patient-switch-race',
  'settings-extremes',
  'sparse-and-malformed',
]);
const REQUIRED_COVERAGE = Object.freeze({
  'full-spectrum': [
    'patient-identity', 'patient-summary',
    'western-outpatient', 'western-emergency', 'western-inpatient', 'western-pharmacy',
    'western-short-14', 'western-long-15', 'chronic-refill', 'medication-days',
    'atc-red', 'atc-orange', 'atc-green', 'special-frequency', 'simplified-name',
    'chinese-multi-hospital', 'chinese-multi-diagnosis', 'chinese-multi-frequency',
    'lab-normal', 'lab-high', 'lab-low', 'lab-non-numeric', 'lab-reference-variants',
    'lab-multi-date', 'lab-ckm-code', 'imaging-with-report', 'imaging-without-report',
    'ct-within-90', 'ct-outside-90', 'mri-within-90', 'mri-outside-90',
    'allergy', 'surgery', 'discharge', 'adult-health', 'four-cancer', 'hepatitis-bc',
  ],
  'empty-and-denied': [
    'all-sources-confirmed-empty', 'partial-unauthorized', 'single-api-403',
    'single-api-500', 'successful-source-isolation',
  ],
  'patient-switch-race': [
    'patient-a-in-flight', 'switch-to-patient-b', 'late-a-data-rejected',
    'late-a-summary-rejected', 'late-a-clipboard-unavailable', 'late-a-status-rejected',
    'patient-b-remains-active',
  ],
  'sparse-and-malformed': [
    'missing-date', 'empty-fields', 'unknown-code', 'duplicate-record',
    'unexpected-reference', 'invalid-token', 'expired-session', 'safe-empty-fallback',
    'no-previous-patient-residue',
  ],
  'boundary-clock': [
    'fixed-clock', 'medication-14-inclusive-short', 'medication-15-long',
    'ct-90-inclusive', 'ct-91-outside', 'mri-90-inclusive', 'mri-91-outside',
    'medication-100-inclusive', 'medication-101-outside', 'lab-180-inclusive',
    'lab-181-outside', 'imaging-180-inclusive', 'imaging-181-outside',
    'cross-year-order', 'same-day-stable-order',
  ],
  'settings-extremes': [
    'every-toggle-off', 'every-toggle-on', 'icon-top-right', 'icon-middle-right',
    'icon-bottom-right', 'text-small', 'text-medium', 'text-large',
    'colorful-tabs-off', 'colorful-tabs-on', 'all-lab-layouts', 'atc-custom-groups',
    'focused-list-order', 'custom-medication-copy', 'custom-lab-copy',
    'copy-all-new-to-old', 'copy-all-old-to-new',
  ],
});
const REQUIRED_BOOLEAN_SETTINGS = Object.freeze([
  'alwaysOpenOverviewTab', 'autoOpenPage', 'enableATC5Colors', 'enableCKMScreening',
  'enableCKMTab', 'enableLabAbbrev', 'enableLabChooseCopy', 'enableLabCopyAll',
  'enableLabCustomCopyFormat', 'enableMedicationCopyAll',
  'enableMedicationCustomCopyFormat', 'enableNephroReport', 'fetchAdultHealthCheck',
  'fetchCancerScreening', 'fetchHbcvdata', 'highlightAbnormal',
  'separateShortTermMeds', 'showATC5Name', 'showChineseDiagnosis', 'showDiagnosis',
  'showEffectName', 'showExternalDrugImage', 'showGenericName', 'showReference',
  'showUnit', 'simplifyMedicineName', 'useColorfulTabs',
]);
const SOURCES = new Set([
  'patient-identity',
  'patient-summary',
  'western-medication',
  'chronic-refill',
  'medication-days',
  'chinese-medication',
  'lab',
  'imaging',
  'allergy',
  'surgery',
  'discharge',
  'adult-health-check',
  'cancer-screening',
  'hepatitis',
]);
const SOURCE_STATUSES = new Set([
  'has-data',
  'confirmed-empty',
  'unauthorized',
  'fetch-failure',
  'malformed',
]);
const FORBIDDEN_PATIENT_KEYS = new Set([
  'birthdate',
  'cardnumber',
  'cookie',
  'medicalrecordnumber',
  'nationalid',
  'patientname',
  'token',
  'url',
]);
const PHI_PATTERNS = Object.freeze([
  {label: 'Taiwan national identifier', regex: /\b[A-Z][12]\d{8}\b/},
  {label: 'Taiwan mobile number', regex: /\b09\d{8}\b/},
  {label: 'email address', regex: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/},
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, location) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${location} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${location} keys differ: ${actual.join(', ')}`);
}

function scanForPhi(value, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForPhi(item, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assert(!FORBIDDEN_PATIENT_KEYS.has(key.toLowerCase()), `${location}.${key} is a forbidden patient identifier field`);
      scanForPhi(child, `${location}.${key}`);
    }
    return;
  }
  if (typeof value === 'string') {
    for (const {label, regex} of PHI_PATTERNS) {
      assert(!regex.test(value), `${location} resembles a ${label}`);
    }
  }
}

function sourceResults(fixture, source) {
  return fixture.events.filter((event) => event.type === 'source-result' && event.source === source);
}

function records(fixture, source, status = 'has-data') {
  return sourceResults(fixture, source)
    .filter((event) => event.status === status)
    .flatMap((event) => event.body?.rObject ?? []);
}

function variant(fixture, id) {
  return fixture.settingsVariants.find((item) => item.id === id)?.values;
}

function calendarAgeDays(now, date) {
  const nowDate = now.slice(0, 10);
  return (Date.parse(`${nowDate}T12:00:00+08:00`) - Date.parse(`${date}T12:00:00+08:00`)) / 86_400_000;
}

function validateFixtureFamilyDetails(fixture, fileName) {
  if (fixture.id === 'full-spectrum') {
    const representedSources = new Set(fixture.events.filter((event) => event.source).map((event) => event.source));
    assert([...SOURCES].every((source) => representedSources.has(source)), `${fileName} must represent every upstream source family`);

    const western = records(fixture, 'western-medication');
    assert(western.length >= 4, `${fileName} needs at least four western medication cases`);
    assert(new Set(western.map((item) => item.fixtureCase)).size >= 4, `${fileName} needs outpatient, emergency, inpatient, and pharmacy cases`);
    assert(western.some((item) => item.order_drug_day === '14') && western.some((item) => item.order_drug_day === '15'), `${fileName} needs 14/15-day medication cases`);
    assert(western.some((item) => item.drug_fre === 'PRN' && item.drug_per_dosage === 'SPECIAL'), `${fileName} needs a special-frequency medication`);
    assert(western.some((item) => /TABLETS?\s+\d+\s*MG/i.test(item.drug_ename)), `${fileName} needs a simplifiable medication name`);
    const atcGroups = new Set(western.map((item) => item.drug_atc5_name));
    assert(atcGroups.has('NSAID') && atcGroups.has('ARB') && atcGroups.has('SGLT2'), `${fileName} needs red/orange/green ATC examples`);

    const chinese = records(fixture, 'chinese-medication');
    assert(new Set(chinese.map((item) => item.hosp)).size >= 2, `${fileName} needs multiple Chinese medication hospitals`);
    assert(new Set(chinese.map((item) => item.icd_code)).size >= 2, `${fileName} needs multiple Chinese medication diagnoses`);
    assert(new Set(chinese.map((item) => item.drug_fre)).size >= 2, `${fileName} needs multiple Chinese medication frequencies`);

    const labs = records(fixture, 'lab');
    assert(['normal', 'high', 'low', 'non-numeric'].every((fixtureCase) => labs.some((item) => item.fixtureCase === fixtureCase)), `${fileName} needs normal/high/low/non-numeric lab cases`);
    assert(labs.some((item) => /^</.test(item.ref_value)) && labs.some((item) => /^>/.test(item.ref_value)) && labs.some((item) => /-/.test(item.ref_value)), `${fileName} needs lab reference variants`);
    assert(new Set(labs.map((item) => item.inspect_date)).size >= 2, `${fileName} needs multi-date labs`);
    assert(labs.some((item) => ['09040C', '12111C'].includes(item.order_code)), `${fileName} needs CKM lab codes`);

    const imaging = records(fixture, 'imaging');
    const imageCases = new Set(imaging.map((item) => item.fixtureCase));
    assert(['ct-with-report-within-90', 'ct-without-report-outside-90', 'mri-with-report-within-90', 'mri-without-report-outside-90'].every((item) => imageCases.has(item)), `${fileName} needs CT/MRI, report/no-report, inside/outside-90 cases`);
    const cancerRows = records(fixture, 'cancer-screening').flatMap((item) => item.result_data ?? []);
    assert(cancerRows.length === 4, `${fileName} needs all four cancer screening examples`);
    return;
  }

  if (fixture.id === 'empty-and-denied') {
    const emptySources = new Set(fixture.events.filter((event) => event.status === 'confirmed-empty').map((event) => event.source));
    assert([...SOURCES].every((source) => emptySources.has(source)), `${fileName} must take every source through confirmed-empty`);
    const failures = fixture.events.filter((event) => event.error).map((event) => event.error.httpStatus);
    assert(failures.filter((status) => status === 403).length === 1, `${fileName} needs exactly one 403`);
    assert(failures.filter((status) => status === 500).length === 1, `${fileName} needs exactly one 500`);
    const usable = fixture.events.filter((event) => event.status === 'has-data');
    assert(usable.length === 1 && fixture.expected.sourceStates[usable[0].source] === 'has-data', `${fileName} must keep one successful source usable after isolated failures`);
    return;
  }

  if (fixture.id === 'patient-switch-race') {
    const lateA = fixture.events.filter((event) => event.seq > 3 && event.patientKey === 'synthetic-patient-race-a');
    assert(lateA.some((event) => event.source === 'lab') && lateA.some((event) => event.source === 'patient-summary'), `${fileName} needs late A data and summary responses`);
    assert(lateA.every((event) => fixture.expected.rejectedEventSeq.includes(event.seq)), `${fileName} must reject every late A response`);
    assert(lateA.some((event) => event.body.clipboardText?.includes('MUST NEVER REACH B')), `${fileName} needs an explicitly rejected late A clipboard candidate`);
    assert(lateA.some((event) => event.body.uiStatus?.includes('MUST NEVER REACH B')), `${fileName} needs an explicitly rejected late A status candidate`);
    assert(fixture.expected.acceptedEventSeq.includes(6) && fixture.expected.activePatientKey === 'synthetic-patient-race-b', `${fileName} must leave patient B active and usable`);
    return;
  }

  if (fixture.id === 'sparse-and-malformed') {
    const issues = records(fixture, 'western-medication', 'malformed').length
      ? sourceResults(fixture, 'western-medication')[0].body.issues
      : [];
    assert(['missing-date', 'empty-name', 'duplicate-record', 'unknown-code'].every((issue) => issues.includes(issue)), `${fileName} needs every sparse western issue`);
    assert(sourceResults(fixture, 'lab')[0].body.issues.includes('invalid-reference'), `${fileName} needs an unexpected lab reference`);
    const invalidCredential = sourceResults(fixture, 'patient-summary').find((event) => event.error?.httpStatus === 401);
    assert(invalidCredential && fixture.expected.acceptedEventSeq.includes(invalidCredential.seq), `${fileName} needs an active-session invalid credential failure`);
    assert(fixture.expected.rejectedEventSeq.length === 1 && fixture.expected.rejectedEventSeq[0] === 8, `${fileName} needs exactly one expired-session response`);
    assert(fixture.expected.sourceStates['patient-summary'] === 'unauthorized', `${fileName} must replace prior patient summary state with the current credential failure`);
    assert(!JSON.stringify(fixture.expected.sourceStates).includes('PREVIOUS PATIENT'), `${fileName} must not retain prior-patient data`);
    return;
  }

  if (fixture.id === 'boundary-clock') {
    assert(fixture.clock.now === '2026-06-30T12:00:00+08:00' && fixture.clock.timezone === 'Asia/Taipei', `${fileName} must use the Ticket 02 fixed clock`);
    const medicationByCode = new Map(records(fixture, 'western-medication').map((item) => [item.drug_code, item]));
    assert(medicationByCode.get('SYN-DAY-14')?.expectedBucket === 'short' && medicationByCode.get('SYN-DAY-15')?.expectedBucket === 'long', `${fileName} must pin the inclusive 14/15 short-long boundary`);
    assert(calendarAgeDays(fixture.clock.now, medicationByCode.get('SYN-AGE-100')?.drug_date) === 100 && medicationByCode.get('SYN-AGE-100')?.expectedTracking === 'boundary', `${fileName} must pin medication day 100 as inclusive`);
    assert(calendarAgeDays(fixture.clock.now, medicationByCode.get('SYN-AGE-101')?.drug_date) === 101 && medicationByCode.get('SYN-AGE-101')?.expectedTracking === 'outside', `${fileName} must pin medication day 101 as outside`);

    const imagingByCode = new Map(records(fixture, 'imaging').map((item) => [item.order_code, item]));
    for (const [modality, insideCode, outsideCode] of [['CT', 'SYN-CT-90', 'SYN-CT-91'], ['MRI', 'SYN-MRI-90', 'SYN-MRI-91']]) {
      assert(calendarAgeDays(fixture.clock.now, imagingByCode.get(insideCode)?.inspect_date) === 90 && imagingByCode.get(insideCode)?.expectedRecent === true, `${fileName} must pin ${modality} day 90 as inclusive`);
      assert(calendarAgeDays(fixture.clock.now, imagingByCode.get(outsideCode)?.inspect_date) === 91 && imagingByCode.get(outsideCode)?.expectedRecent === false, `${fileName} must pin ${modality} day 91 as outside`);
    }
    assert(calendarAgeDays(fixture.clock.now, imagingByCode.get('SYN-IMG-180')?.inspect_date) === 180 && imagingByCode.get('SYN-IMG-180')?.expectedTracking === 'boundary', `${fileName} must pin imaging day 180 as inclusive`);
    assert(calendarAgeDays(fixture.clock.now, imagingByCode.get('SYN-IMG-181')?.inspect_date) === 181 && imagingByCode.get('SYN-IMG-181')?.expectedTracking === 'outside', `${fileName} must pin imaging day 181 as outside`);

    const labs = records(fixture, 'lab');
    const labByCode = new Map(labs.map((item) => [item.order_code, item]));
    assert(calendarAgeDays(fixture.clock.now, labByCode.get('SYN-LAB-180')?.inspect_date) === 180 && labByCode.get('SYN-LAB-180')?.expectedTracking === 'boundary', `${fileName} must pin lab day 180 as inclusive`);
    assert(calendarAgeDays(fixture.clock.now, labByCode.get('SYN-LAB-181')?.inspect_date) === 181 && labByCode.get('SYN-LAB-181')?.expectedTracking === 'outside', `${fileName} must pin lab day 181 as outside`);
    assert(labs.slice(-2).map((item) => item.order_code).join(',') === 'SYN-LAB-SAME-DAY-B,SYN-LAB-SAME-DAY-A', `${fileName} must pin stable same-day input order across the year boundary`);
    return;
  }

  if (fixture.id === 'settings-extremes') {
    const minimal = variant(fixture, 'minimal');
    const maximal = variant(fixture, 'maximal');
    const minimalBooleanKeys = Object.keys(minimal).filter((key) => typeof minimal[key] === 'boolean').sort();
    const maximalBooleanKeys = Object.keys(maximal).filter((key) => typeof maximal[key] === 'boolean').sort();
    assert(JSON.stringify(minimalBooleanKeys) === JSON.stringify([...REQUIRED_BOOLEAN_SETTINGS].sort()), `${fileName} minimal variant must contain the complete Ticket 02 toggle registry`);
    assert(JSON.stringify(maximalBooleanKeys) === JSON.stringify([...REQUIRED_BOOLEAN_SETTINGS].sort()), `${fileName} maximal variant must contain the complete Ticket 02 toggle registry`);
    assert(minimalBooleanKeys.every((key) => minimal[key] === false && maximal[key] === true), `${fileName} must exercise every toggle at both ends`);
    const positions = new Set(fixture.settingsVariants.map((item) => item.values.floatingIconPosition).filter(Boolean));
    assert(['top-right', 'middle-right', 'bottom-right'].every((position) => positions.has(position)), `${fileName} needs all icon positions`);
    const textSizes = new Set(fixture.settingsVariants.map((item) => item.values.titleTextSize).filter(Boolean));
    assert(['small', 'medium', 'large'].every((size) => textSizes.has(size)), `${fileName} needs all text sizes`);
    for (const key of ['contentTextSize', 'noteTextSize']) {
      const sizes = new Set(fixture.settingsVariants.map((item) => item.values[key]).filter(Boolean));
      assert(['small', 'medium', 'large'].every((size) => sizes.has(size)), `${fileName} needs all ${key} values`);
    }
    const layouts = new Set(fixture.settingsVariants.map((item) => item.values.displayLabFormat).filter(Boolean));
    assert(['byType', 'vertical', 'horizontal', 'twoColumn', 'threeColumn'].every((layout) => layouts.has(layout)), `${fileName} needs all five lab layouts`);
    const orders = new Set(fixture.settingsVariants.map((item) => item.values.medicationCopyAllOrder).filter(Boolean));
    assert(orders.has('newToOld') && orders.has('oldToNew'), `${fileName} needs both copy-all orders`);
    const labOrders = new Set(fixture.settingsVariants.map((item) => item.values.labCopyAllOrder).filter(Boolean));
    assert(labOrders.has('newToOld') && labOrders.has('oldToNew'), `${fileName} needs both lab copy-all orders`);
    assert(maximal.customMedicationCopy?.length > 0 && maximal.customLabCopy?.length > 0, `${fileName} needs custom medication and lab copy editor values`);
    assert(maximal.atcGroups?.length >= 2 && maximal.trackedLabs?.join(',') === 'LAB-SYN-B,LAB-SYN-A', `${fileName} needs custom ATC groups and stable tracked-lab order`);
  }
}

function validateFixture(fixture, fileName) {
  exactKeys(fixture, ['$schema', 'fixtureVersion', 'id', 'synthetic', 'description', 'coverage', 'clock', 'sessions', 'settingsVariants', 'events', 'expected'], fileName);
  assert(fixture.$schema === './fixture.schema.json', `${fileName} has an unexpected schema reference`);
  assert(fixture.fixtureVersion === 1, `${fileName} has an unexpected fixture version`);
  assert(fixture.synthetic === true, `${fileName} must be explicitly synthetic`);
  assert(REQUIRED_FIXTURES.includes(fixture.id), `${fileName} has an unknown fixture id`);
  assert(fileName === `${fixture.id}.json`, `${fileName} must match fixture id ${fixture.id}`);
  assert(typeof fixture.description === 'string' && fixture.description.length > 0, `${fileName} needs a description`);
  assert(Array.isArray(fixture.coverage), `${fileName}.coverage must be an array`);
  assert(new Set(fixture.coverage).size === fixture.coverage.length, `${fileName}.coverage must not contain duplicates`);
  assert(
    JSON.stringify([...fixture.coverage].sort()) === JSON.stringify([...REQUIRED_COVERAGE[fixture.id]].sort()),
    `${fileName}.coverage must exactly enumerate the Ticket 02 family contract`,
  );

  exactKeys(fixture.clock, ['now', 'timezone'], `${fileName}.clock`);
  assert(fixture.clock.timezone === 'Asia/Taipei', `${fileName} must pin Asia/Taipei`);
  assert(!Number.isNaN(Date.parse(fixture.clock.now)), `${fileName} clock must be ISO-8601`);

  assert(Array.isArray(fixture.sessions) && fixture.sessions.length > 0, `${fileName} needs sessions`);
  const sessions = new Map();
  for (const [index, session] of fixture.sessions.entries()) {
    exactKeys(session, ['id', 'patientKey'], `${fileName}.sessions[${index}]`);
    assert(/^fixture-session-[a-z0-9-]+$/.test(session.id), `${fileName} session id must be synthetic`);
    assert(/^synthetic-patient-[a-z0-9-]+$/.test(session.patientKey), `${fileName} patient key must be synthetic`);
    assert(!sessions.has(session.id), `${fileName} has a duplicate session id`);
    sessions.set(session.id, session.patientKey);
  }

  assert(Array.isArray(fixture.settingsVariants) && fixture.settingsVariants.length > 0, `${fileName} needs settings variants`);
  for (const [index, variant] of fixture.settingsVariants.entries()) {
    exactKeys(variant, ['id', 'values'], `${fileName}.settingsVariants[${index}]`);
    assert(typeof variant.id === 'string' && variant.id.length > 0, `${fileName} settings id is required`);
    assert(variant.values && typeof variant.values === 'object' && !Array.isArray(variant.values), `${fileName} settings values must be an object`);
  }

  assert(Array.isArray(fixture.events) && fixture.events.length > 0, `${fileName} needs events`);
  let previousSequence = 0;
  for (const [index, event] of fixture.events.entries()) {
    const location = `${fileName}.events[${index}]`;
    assert(Number.isSafeInteger(event.seq) && event.seq > previousSequence, `${location} sequence must increase`);
    previousSequence = event.seq;
    assert(sessions.get(event.sessionId) === event.patientKey, `${location} session/patient pair is not declared`);
    if (event.type === 'session-start' || event.type === 'session-end') {
      exactKeys(event, ['seq', 'type', 'sessionId', 'patientKey'], location);
    } else if (event.type === 'source-result') {
      exactKeys(event, ['seq', 'type', 'sessionId', 'patientKey', 'source', 'status', 'body', 'error'], location);
      assert(SOURCES.has(event.source), `${location} has unknown source ${event.source}`);
      assert(SOURCE_STATUSES.has(event.status), `${location} has unknown status ${event.status}`);
      if (event.status === 'unauthorized' || event.status === 'fetch-failure') {
        assert(event.body === null, `${location} failure body must be null`);
        assert(event.error && typeof event.error.code === 'string', `${location} failure needs a synthetic error code`);
      } else {
        assert(event.error === null, `${location} non-failure error must be null`);
        assert(event.body && typeof event.body === 'object', `${location} non-failure body must be an object`);
      }
    } else {
      throw new Error(`${location} has unknown event type ${event.type}`);
    }
  }

  exactKeys(fixture.expected, ['activeSessionId', 'activePatientKey', 'acceptedEventSeq', 'rejectedEventSeq', 'sourceStates'], `${fileName}.expected`);
  validateFixtureFamilyDetails(fixture, fileName);
  scanForPhi(fixture);
}

function replay(events) {
  const state = {
    activeSessionId: null,
    activePatientKey: null,
    acceptedEventSeq: [],
    rejectedEventSeq: [],
    sourceStates: {},
  };

  for (const event of events) {
    if (event.type === 'session-start') {
      state.activeSessionId = event.sessionId;
      state.activePatientKey = event.patientKey;
      state.sourceStates = {};
      state.acceptedEventSeq.push(event.seq);
      continue;
    }

    const matchesActive = event.sessionId === state.activeSessionId && event.patientKey === state.activePatientKey;
    if (!matchesActive) {
      state.rejectedEventSeq.push(event.seq);
      continue;
    }

    state.acceptedEventSeq.push(event.seq);
    if (event.type === 'session-end') {
      state.activeSessionId = null;
      state.activePatientKey = null;
      state.sourceStates = {};
    } else {
      state.sourceStates[event.source] = event.status;
    }
  }
  return state;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const files = (await readdir(FIXTURE_DIRECTORY))
  .filter((file) => file.endsWith('.json') && file !== 'fixture.schema.json')
  .sort();
assert(JSON.stringify(files) === JSON.stringify(REQUIRED_FIXTURES.map((id) => `${id}.json`).sort()), 'fixture directory must contain exactly the six required families');

const report = [];
for (const file of files) {
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIRECTORY, file), 'utf8'));
  validateFixture(fixture, file);
  const firstReplay = replay(fixture.events);
  const secondReplay = replay(fixture.events);
  assert(JSON.stringify(firstReplay) === JSON.stringify(secondReplay), `${file} replay is not deterministic`);
  assert(JSON.stringify(canonical(firstReplay)) === JSON.stringify(canonical(fixture.expected)), `${file} replay differs from expected state`);
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical(firstReplay))).digest('hex');
  report.push({id: fixture.id, events: fixture.events.length, fingerprint});
}

console.log(`Synthetic characterization fixtures: ${report.length}/${REQUIRED_FIXTURES.length} passed`);
for (const result of report) console.log(`- ${result.id}: ${result.events} events, sha256:${result.fingerprint}`);
