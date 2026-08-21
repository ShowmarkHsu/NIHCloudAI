import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {DEFAULT_SETTINGS} from '../../src/config/defaultSettings.js';
import {chineseMedProcessor} from '../../src/utils/chineseMedProcessor.js';
import {imagingProcessor} from '../../src/utils/imagingProcessor.js';
import {labCopyFormatter} from '../../src/utils/labCopyFormatter.js';
import {labProcessor} from '../../src/utils/labProcessor.js';
import {medicationProcessor} from '../../src/utils/medicationProcessor.js';

const ROOT = process.cwd();
const FIXED_NOW = '2026-06-30T12:00:00+08:00';
const tests = [];

globalThis.window = {};
globalThis.chrome = {
  storage: {
    sync: {
      get(defaults, callback) {
        callback(structuredClone(defaults));
      },
    },
  },
};

function test(name, run) {
  tests.push({name, run});
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), 'utf8'));
}

async function withQuietConsole(run) {
  const original = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    Object.assign(console, original);
  }
}

function assertFingerprint(label, value, expected) {
  const actual = fingerprint(value);
  assert.equal(actual, expected, `${label} sha256:${actual}`);
}

async function assertClipboardGolden(id, actual) {
  const goldens = await readJson('tests/characterization/goldens/clipboard.json');
  const golden = goldens[id];
  assert.ok(golden, `missing clipboard golden: ${id}`);
  assert.deepEqual(Buffer.from(actual, 'utf8'), Buffer.from(golden.text, 'utf8'), `${id} UTF-8 bytes differ`);
  assert.deepEqual(actual.split('\n'), golden.lines, `${id} LF line structure differs`);
  assert.equal(actual.includes('\r'), false, `${id} must use LF only`);
}

test('defaultSettings.js exports the exact upstream baseline defaults', () => {
  assertFingerprint('default settings', DEFAULT_SETTINGS, '2a073a8d92823e6f298b02302ec932773f5d0bce239d5066918dab200fe0caff');
  assert.deepEqual(
    {
      general: DEFAULT_SETTINGS.general,
      cloud: DEFAULT_SETTINGS.cloud,
      overviewWindows: {
        medication: DEFAULT_SETTINGS.overview.medicationTrackingDays,
        lab: DEFAULT_SETTINGS.overview.labTrackingDays,
        imaging: DEFAULT_SETTINGS.overview.imageTrackingDays,
      },
      western: {
        simplifyMedicineName: DEFAULT_SETTINGS.western.simplifyMedicineName,
        showGenericName: DEFAULT_SETTINGS.western.showGenericName,
        showDiagnosis: DEFAULT_SETTINGS.western.showDiagnosis,
        showATC5Name: DEFAULT_SETTINGS.western.showATC5Name,
        separateShortTermMeds: DEFAULT_SETTINGS.western.separateShortTermMeds,
        showExternalDrugImage: DEFAULT_SETTINGS.western.showExternalDrugImage,
        enableMedicationCustomCopyFormat: DEFAULT_SETTINGS.western.enableMedicationCustomCopyFormat,
        enableMedicationCopyAll: DEFAULT_SETTINGS.western.enableMedicationCopyAll,
        medicationCopyAllOrder: DEFAULT_SETTINGS.western.medicationCopyAllOrder,
      },
      chinese: DEFAULT_SETTINGS.chinese,
      labCore: {
        displayLabFormat: DEFAULT_SETTINGS.lab.displayLabFormat,
        showUnit: DEFAULT_SETTINGS.lab.showUnit,
        showReference: DEFAULT_SETTINGS.lab.showReference,
        enableLabAbbrev: DEFAULT_SETTINGS.lab.enableLabAbbrev,
        highlightAbnormal: DEFAULT_SETTINGS.lab.highlightAbnormal,
        copyLabFormat: DEFAULT_SETTINGS.lab.copyLabFormat,
        enableLabChooseCopy: DEFAULT_SETTINGS.lab.enableLabChooseCopy,
        enableLabCustomCopyFormat: DEFAULT_SETTINGS.lab.enableLabCustomCopyFormat,
        enableLabCopyAll: DEFAULT_SETTINGS.lab.enableLabCopyAll,
        labCopyAllOrder: DEFAULT_SETTINGS.lab.labCopyAllOrder,
      },
      atcGroupNames: Object.keys(DEFAULT_SETTINGS.atc5.groups),
      atcColors: DEFAULT_SETTINGS.atc5.colorGroups,
    },
    {
      general: {
        autoOpenPage: false,
        titleTextSize: 'small',
        contentTextSize: 'small',
        noteTextSize: 'small',
        floatingIconPosition: 'middle-right',
        alwaysOpenOverviewTab: true,
        useColorfulTabs: true,
        enableCKMTab: false,
        enableNephroReport: false,
        enableCKMScreening: false,
      },
      cloud: {fetchAdultHealthCheck: false, fetchCancerScreening: false, fetchHbcvdata: true},
      overviewWindows: {medication: 100, lab: 180, imaging: 180},
      western: {
        simplifyMedicineName: true,
        showGenericName: false,
        showDiagnosis: true,
        showATC5Name: false,
        separateShortTermMeds: true,
        showExternalDrugImage: false,
        enableMedicationCustomCopyFormat: false,
        enableMedicationCopyAll: false,
        medicationCopyAllOrder: 'newToOld',
      },
      chinese: {
        showDiagnosis: false,
        showEffectName: false,
        doseFormat: 'perDay',
        copyFormat: 'nameWithDosageVertical',
      },
      labCore: {
        displayLabFormat: 'byType',
        showUnit: false,
        showReference: false,
        enableLabAbbrev: true,
        highlightAbnormal: true,
        copyLabFormat: 'horizontal',
        enableLabChooseCopy: false,
        enableLabCustomCopyFormat: false,
        enableLabCopyAll: false,
        labCopyAllOrder: 'newToOld',
      },
      atcGroupNames: ['NSAID', 'ACEI', 'ARB', 'STATIN', 'SGLT2', 'GLP1', '抗凝'],
      atcColors: {
        red: ['抗凝', 'NSAID'],
        orange: ['ARB', 'ACEI', 'STATIN'],
        green: ['SGLT2', 'GLP1'],
      },
    },
  );
});

test('non-AI tabs retain relative order and Advanced remains conditional', async () => {
  const source = await readFile(path.join(ROOT, 'src/components/FloatingIcon.jsx'), 'utf8');
  const overviewHandler = source.indexOf('onClick={handleOverviewClick}');
  const tabs = source.indexOf('<Tabs', overviewHandler);
  assert.ok(overviewHandler >= 0 && tabs > overviewHandler, 'Overview entry must precede the scrollable tabs');

  const tokens = [
    'label={`西藥 (',
    'aria-label="西藥表格檢視"',
    'label={`中藥 (',
    'label={`檢驗 (',
    'aria-label="檢驗表格檢視"',
    'label={`影像 (',
    'label={`餘藥 (',
    'label="說明"',
    'label="進階"',
  ];
  let cursor = tabs;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor);
    assert.ok(index > cursor, `tab token out of order or missing: ${token}`);
    cursor = index;
  }

  const advancedCondition = 'appSettings.western.enableMedicationCustomCopyFormat || appSettings.lab.enableLabCustomCopyFormat';
  assert.equal(source.split(advancedCondition).length - 1, 2, 'Advanced tab and panel must share the same condition');
  const tabIds = [
    ['MEDICATION_LIST', 0], ['MEDICATION_TABLE', 1], ['CHINESE_MEDICINE', 2], ['LAB_DATA', 3],
    ['LAB_TABLE', 4], ['IMAGING', 5], ['MEDICATION_DAYS', 6], ['HELP', 7], ['ADVANCED', 8],
  ];
  for (const [tabId, index] of tabIds) {
    assert.match(source, new RegExp(`${tabId}: ${index}`), `stable ID must preserve ${tabId}'s legacy value`);
  }
  assert.doesNotMatch(source, /const helpTabIndex = 7;|const advancedTabIndex = 8;/);
  assert.match(source, /index=\{TAB_IDS\.HELP\}/);
  assert.match(source, /index=\{TAB_IDS\.ADVANCED\}/);
  for (const [tabId] of tabIds.slice(0, -2)) {
    assert.match(source, new RegExp(`<Tab\\s+value=\\{TAB_IDS\\.${tabId}\\}`));
  }
  assert.match(source, /<Tab\s+value=\{TAB_IDS\.HELP\}/);
  assert.match(source, /<Tab\s+value=\{TAB_IDS\.ADVANCED\}/);
  assert.doesNotMatch(source, /setTabValue\(message\.tabIndex\)/);
  assert.equal((source.match(/setTabValue\(TAB_IDS\.ADVANCED\)/g) || []).length, 4);
  for (const [tabId, component] of [
    ['MEDICATION_LIST', 'MedicationList'], ['MEDICATION_TABLE', 'MedicationTable'],
    ['CHINESE_MEDICINE', 'ChineseMedicine'], ['LAB_DATA', 'LabData'], ['LAB_TABLE', 'LabTableView'],
    ['IMAGING', 'ImagingData'], ['MEDICATION_DAYS', 'MedDaysData'],
  ]) {
    assert.match(source, new RegExp(`<TabPanel value=\\{tabValue\\} index=\\{TAB_IDS\\.${tabId}\\}>[\\s\\S]{0,180}<${component}`));
  }
});

test('AI summary tab is an append-only closed presentation surface with no legacy message route', async () => {
  const source = await readFile(path.join(ROOT, 'src/components/FloatingIcon.jsx'), 'utf8');
  const tabs = source.indexOf('<Tabs');
  const advancedTab = source.indexOf('label="進階"', tabs);
  const aiSummaryTab = source.indexOf('label="AI 摘要"', tabs);

  assert.match(source, /import \{ AI_SUMMARY_TAB_ID \} from "\.\.\/ai\/session\/tabActivation";/);
  assert.match(source, /AI_SUMMARY: AI_SUMMARY_TAB_ID/, 'AI tab must use a non-numeric stable ID');
  assert.ok(advancedTab > tabs, 'legacy Advanced tab must remain present in the tab strip');
  assert.ok(aiSummaryTab > advancedTab, 'AI tab must append after every legacy tab, including conditional Advanced');
  assert.match(source, /<Tab\s+value=\{TAB_IDS\.AI_SUMMARY\}\s+label="AI 摘要"/);
  assert.match(source, /import AiSummaryTab from "\.\/tabs\/AiSummaryTab";/);
  assert.match(source, /<TabPanel value=\{tabValue\} index=\{TAB_IDS\.AI_SUMMARY\}>\s*<AiSummaryTab\s*\/>\s*<\/TabPanel>/);
  assert.doesNotMatch(source, /iframe|runtime\.sendMessage|chrome\.runtime/);
});

test('fixed clock is explicit and remaining-days characterization accepts injected now', async () => {
  const fixture = await readJson('tests/fixtures/clinical/boundary-clock.json');
  assert.equal(fixture.clock.now, FIXED_NOW);
  assert.equal(fixture.clock.timezone, 'Asia/Taipei');
  const fixedNowMs = Date.parse(FIXED_NOW);
  assert.equal(chineseMedProcessor.calculateRemainingDays(14, '2026-06-17', fixedNowMs), 1);
  assert.equal(chineseMedProcessor.calculateRemainingDays(14, '2026-06-16', fixedNowMs), 0);
});

test('untouched upstream processors retain exact observable output', async () => {
  const medicationInput = {rObject: [
    {drug_date: '2026/06/30', hosp: 'SYNTHETIC CLINIC;門診', icd_code: 'Z00', icd_cname: 'SYNTHETIC DIAGNOSIS', drug_ename: 'SYNTHETIC ALPHA TABLETS 10 MG', drug_ing_name: 'SYNTHETIC INGREDIENT A', qty: '14', drug_fre: 'QD', day: '14', drug_atc7_code: 'A10BK01', drug_atc5_name: 'SGLT2', drug_left: '3', drug_code: 'SYN-MED-A'},
    {drug_date: '2026/06/30', hosp: 'SYNTHETIC CLINIC;門診', icd_code: 'Z00', icd_cname: 'SYNTHETIC DIAGNOSIS', drug_ename: 'SYNTHETIC RESCUE', drug_ing_name: 'SYNTHETIC INGREDIENT B', qty: '6', drug_fre: 'PRN', day: '3', drug_atc7_code: 'M01AE01', drug_atc5_name: 'NSAID', drug_left: '0', drug_code: 'SYN-MED-B'},
    {drug_date: '2026/06/29', hosp: 'SYNTHETIC HOSPITAL;住診', icd_code: 'Z01', icd_cname: 'SYNTHETIC FOLLOWUP', drug_ename: 'SYNTHETIC BETA', drug_ing_name: 'SYNTHETIC INGREDIENT C', qty: '30', drug_fre: 'BID', day: '15', drug_atc7_code: 'C09CA01', drug_atc5_name: 'ARB', drug_left: '1', drug_code: 'SYN-MED-C'},
  ]};
  const chineseInput = {rObject: [
    {func_date: '2026-06-28T00:00:00+08:00', hosp: 'SYNTHETIC TCM A;門診;SYN-A', icd_code: 'Z02', icd_cname: 'SYNTHETIC TCM DIAGNOSIS', day: 7, drug_fre: 'BID', drug_perscrn_name: 'SYNTHETIC FORMULA ', cdrug_name: 'SYNTHETIC FORMULA PRODUCT', cdrug_sosc_name: 'SYNTHETIC EFFECT', order_qty: 21, cdrug_dose_name: 'SYNTHETIC GRANULE', drug_multi_mark: 'Y'},
    {func_date: '2026-06-28T00:00:00+08:00', hosp: 'SYNTHETIC TCM A;門診;SYN-A', icd_code: 'Z02', icd_cname: 'SYNTHETIC TCM DIAGNOSIS', day: 7, drug_fre: 'BID', drug_perscrn_name: 'SYNTHETIC SINGLE', cdrug_name: 'SYNTHETIC SINGLE PRODUCT', cdrug_sosc_name: '', order_qty: 7, cdrug_dose_name: 'SYNTHETIC POWDER', drug_multi_mark: 'N'},
  ]};
  const labInput = {rObject: [
    {real_inspect_date: '2026/06/27', hosp: 'SYNTHETIC LAB;門診', icd_code: 'Z03', icd_cname: 'SYNTHETIC LAB DIAGNOSIS', assay_item_name: 'SYNTHETIC ANALYTE HIGH', assay_value: '123.4', unit_data: 'u/L', consult_value: '10-100', assay_tp_cname: '生化學檢查', order_name: 'SYNTHETIC TEST A', order_code: 'SYN-LAB-A', assay_method: 'SYNTHETIC METHOD'},
    {real_inspect_date: '2026/06/27', hosp: 'SYNTHETIC LAB;門診', icd_code: 'Z03', icd_cname: 'SYNTHETIC LAB DIAGNOSIS', assay_item_name: 'SYNTHETIC ANALYTE TEXT', assay_value: 'NEGATIVE', unit_data: '', consult_value: 'NEGATIVE', assay_tp_cname: '其它檢驗', order_name: 'SYNTHETIC TEST B', order_code: 'SYN-LAB-B', assay_method: ''},
  ]};
  const imagingInput = {rObject: [
    {real_inspect_date: '2026/06/26', hosp: 'SYNTHETIC IMAGING;門診', order_name: 'SYNTHETIC CT;CHEST', inspect_result: 'REPORT-LINE-1\n', path_diag_2: 'REPORT-LINE-2', path_diag_3: '\nREPORT-LINE-3', order_code: 'SYN-IMG-A', cure_path_name: 'SYNTHETIC CHEST'},
    {real_inspect_date: '2026/06/25', hosp: 'SYNTHETIC IMAGING;門診', order_name: 'SYNTHETIC MRI', inspect_result: '', path_diag_2: '', path_diag_3: '', order_code: 'SYN-IMG-B'},
  ]};

  const medicationOutput = await withQuietConsole(() => medicationProcessor.processMedicationData(medicationInput));
  const chineseOutput = await withQuietConsole(() => chineseMedProcessor.processChineseMedData(chineseInput));
  const labOutput = await withQuietConsole(() => labProcessor.processLabData(labInput));
  const imagingOutput = await withQuietConsole(() => imagingProcessor.processImagingData(imagingInput));

  assertFingerprint('medication processor', medicationOutput, '842fe409a6cac176e812530ccdec0a17246a3f46916b0e85efefe94a5c8220d1');
  assertFingerprint('chinese medication processor', chineseOutput, 'e4b3c4393025e8b5dfdb121580442074eac1de34153b6a326a475d166408bebb');
  assertFingerprint('lab processor', labOutput, 'c8746c8328ca1de54f072fb995e7344330c98b315086b5d7146914838ae1037c');
  assertFingerprint('imaging processor', imagingOutput, '795ca29db3056974e29f75e7f71201a667edb7ab511bfd43aff83be82c5cde7a');
  assert.deepEqual(
    JSON.parse(JSON.stringify(canonical({medicationOutput, chineseOutput, labOutput, imagingOutput}))),
    await readJson('tests/characterization/goldens/processors.json'),
  );
  assert.deepEqual(medicationOutput.map(({date, hosp, visitType, medications}) => ({date, hosp, visitType, names: medications.map(({name}) => name)})), [
    {date: '2026/06/30', hosp: 'SYNTHETIC CLINIC', visitType: '門診', names: ['SYNTHETIC ALPHA (10)', 'SYNTHETIC RESCUE']},
    {date: '2026/06/29', hosp: 'SYNTHETIC HOSPITAL', visitType: '住診', names: ['SYNTHETIC BETA']},
  ]);
  assert.deepEqual(chineseOutput.map(({date, hosp, dosage}) => ({date, hosp, dosage})), [
    {date: '2026/06/28', hosp: 'SYNTHETIC TCM A', dosage: 28},
  ]);
  assert.deepEqual(labOutput.map(({date, hosp, labs}) => ({date, hosp, statuses: labs.map(({valueStatus}) => valueStatus)})), [
    {date: '2026-06-27', hosp: 'SYNTHETIC LAB', statuses: ['normal', 'normal']},
  ]);
  assert.equal(imagingOutput.withReport.length, 1);
  assert.equal(imagingOutput.withoutReport.length, 1);
  assert.match(imagingOutput.withReport[0].inspectResult, /^REPORT-LINE-1\nREPORT-LINE-2\nREPORT-LINE-3$/);
});

test('medication clipboard output matches byte and LF goldens', async () => {
  const medications = [
    {name: 'SYNTHETIC ALPHA', dosage: '14', perDosage: '1', frequency: 'QD', days: '14'},
    {name: 'SYNTHETIC RESCUE', dosage: '6', perDosage: 'SPECIAL', frequency: 'PRN', days: '3'},
  ];
  const group = {
    date: '2026/06/30', hosp: 'SYNTHETIC CLINIC', icd_code: 'Z00', icd_name: 'SYNTHETIC DIAGNOSIS',
    showDiagnosis: true, drugSeparator: ' | ',
    customMedicationHeaderCopyFormat: DEFAULT_SETTINGS.western.customMedicationHeaderCopyFormat,
    customMedicationDrugCopyFormat: DEFAULT_SETTINGS.western.customMedicationDrugCopyFormat,
  };
  const outputs = await withQuietConsole(() => ({
    'medication-standard-vertical': medicationProcessor.formatMedicationList(medications, 'nameWithDosageVertical', group),
    'medication-standard-horizontal': medicationProcessor.formatMedicationList(medications, 'nameWithDosageHorizontal', group),
    'medication-custom-vertical': medicationProcessor.formatMedicationList(medications, 'customVertical', group),
    'medication-custom-horizontal': medicationProcessor.formatMedicationList(medications, 'customHorizontal', group),
  }));
  for (const [id, output] of Object.entries(outputs)) await assertClipboardGolden(id, output);
});

test('lab clipboard output matches byte and LF goldens', async () => {
  const labs = [
    {itemName: 'SYNTHETIC ANALYTE A', value: '123.4', unit: 'u/L', consultValue: {min: '10', max: '100'}},
    {itemName: 'SYNTHETIC ANALYTE B', value: 'NEGATIVE', unit: '', consultValue: 'NEGATIVE'},
  ];
  const group = {date: '2026-06-29', hosp: 'SYNTHETIC LAB'};
  const common = {showUnit: true, showReference: true};
  const outputs = await withQuietConsole(() => ({
    'lab-standard-vertical': labCopyFormatter.applyVerticalFormat(labs, group, common),
    'lab-standard-horizontal': labCopyFormatter.applyHorizontalFormat(labs, group, common),
    'lab-custom-vertical': labCopyFormatter.applyCustomFormat(labs, group, {...DEFAULT_SETTINGS.lab, ...common, copyLabFormat: 'customVertical'}),
    'lab-custom-horizontal': labCopyFormatter.applyCustomFormat(labs, group, {...DEFAULT_SETTINGS.lab, ...common, copyLabFormat: 'customHorizontal', itemSeparator: ' | '}),
  }));
  for (const [id, output] of Object.entries(outputs)) await assertClipboardGolden(id, output);
});

test('Chinese medication clipboard output matches byte and LF goldens', async () => {
  const group = {
    date: '2026/06/28', hosp: 'SYNTHETIC TCM', days: 7, freq: 'BID',
    icd_code: 'Z02', icd_name: 'SYNTHETIC TCM DIAGNOSIS',
    medications: [
      {name: 'SYNTHETIC SINGLE', dosage: 7, dailyDosage: '1', perDosage: '0.5', sosc_name: ''},
      {name: 'SYNTHETIC FORMULA', dosage: 21, dailyDosage: '3', perDosage: '1.5', sosc_name: 'SYNTHETIC EFFECT'},
    ],
  };
  const common = {showDiagnosis: true, showEffectName: true, doseFormat: 'perDay'};
  await assertClipboardGolden('chinese-medication-vertical', chineseMedProcessor.formatChineseMedList(group, {...common, copyFormat: 'nameWithDosageVertical'}));
  await assertClipboardGolden('chinese-medication-horizontal', chineseMedProcessor.formatChineseMedList(group, {...common, copyFormat: 'nameWithDosageHorizontal'}));
});

test('imaging clipboard is exactly the expanded full report', async () => {
  const output = imagingProcessor.processImagingData({rObject: [{
    real_inspect_date: '2026/06/26', hosp: 'SYNTHETIC IMAGING;門診', order_name: 'SYNTHETIC CT',
    inspect_result: 'REPORT-LINE-1\n', path_diag_2: 'REPORT-LINE-2', path_diag_3: '\nREPORT-LINE-3',
  }]});
  await assertClipboardGolden('imaging-full-report', output.withReport[0].inspectResult);
});

let passed = 0;
for (const {name, run} of tests) {
  try {
    await run();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
console.log(`Non-AI characterization: ${passed}/${tests.length} passed`);
