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

function validateFixture(fixture, fileName) {
  exactKeys(fixture, ['$schema', 'fixtureVersion', 'id', 'synthetic', 'description', 'clock', 'sessions', 'settingsVariants', 'events', 'expected'], fileName);
  assert(fixture.$schema === './fixture.schema.json', `${fileName} has an unexpected schema reference`);
  assert(fixture.fixtureVersion === 1, `${fileName} has an unexpected fixture version`);
  assert(fixture.synthetic === true, `${fileName} must be explicitly synthetic`);
  assert(REQUIRED_FIXTURES.includes(fixture.id), `${fileName} has an unknown fixture id`);
  assert(fileName === `${fixture.id}.json`, `${fileName} must match fixture id ${fixture.id}`);
  assert(typeof fixture.description === 'string' && fixture.description.length > 0, `${fileName} needs a description`);

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
