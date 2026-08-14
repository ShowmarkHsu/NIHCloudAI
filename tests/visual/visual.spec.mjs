import {expect, test} from '@playwright/test';

const tabOrder = [
  /西藥 \(/,
  '西藥表格檢視',
  /中藥 \(/,
  /檢驗 \(/,
  '檢驗表格檢視',
  /影像 \(/,
  /餘藥 \(/,
  '說明',
];

function observePageErrors(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return pageErrors;
}

async function openFloating(page, {
  fixture = 'full-spectrum',
  variant = 'default',
  settingsFixture,
} = {}) {
  const pageErrors = observePageErrors(page);
  const query = new globalThis.URLSearchParams({surface: 'floating', fixture, variant});
  if (settingsFixture) query.set('settingsFixture', settingsFixture);
  await page.goto(`/tests/visual/index.html?${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-harness-ready', 'true');
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  await page.getByAltText('NHI Extractor').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleName(/SYNTHETIC/);
  await expect(dialog.getByRole('tablist')).toBeVisible();
  return {dialog, pageErrors};
}

async function assertTabContract(dialog, advanced) {
  const tabs = dialog.locator('.MuiDialogTitle-root [role="tab"]');
  await expect(tabs).toHaveCount(advanced ? 9 : 8);
  for (let index = 0; index < tabOrder.length; index += 1) {
    await expect(tabs.nth(index)).toHaveAccessibleName(tabOrder[index]);
  }
  if (advanced) await expect(tabs.nth(8)).toHaveAccessibleName('進階');
  else await expect(dialog.getByRole('tab', {name: '進階'})).toHaveCount(0);
}

async function assertNoTabOverlap(dialog) {
  const boxes = await dialog.getByRole('tab').evaluateAll((tabs) => tabs
    .filter((tab) => tab.getClientRects().length > 0)
    .map((tab) => {
      const rect = tab.getBoundingClientRect();
      return {left: rect.left, right: rect.right, top: rect.top};
    }));
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    if (Math.abs(previous.top - current.top) < 2) {
      expect(current.left).toBeGreaterThanOrEqual(previous.right - 1);
    }
  }
}

async function findVisibleControlsClippedBy(region) {
  return region.locator([
    'button',
    '[role="tab"]',
    '[role="switch"]',
    '[role="radio"]',
    '[role="combobox"]',
    'select',
    'textarea',
    'a[href]',
  ].join(',')).evaluateAll((controls, container) => {
    const boundary = container.getBoundingClientRect();
    return controls.map((control) => {
      const rect = control.getBoundingClientRect();
      const style = globalThis.getComputedStyle(control);
      const rendered = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      const intersects = rendered && rect.bottom > boundary.top && rect.top < boundary.bottom;
      return {
        name: control.getAttribute('aria-label') || control.textContent?.trim().slice(0, 60) || control.tagName,
        clipped: intersects && (rect.left < boundary.left - 1 || rect.right > boundary.right + 1),
      };
    }).filter(({clipped}) => clipped);
  }, await region.elementHandle());
}

async function assertVisibleControlsNotClipped(region) {
  expect(await findVisibleControlsClippedBy(region)).toEqual([]);
}

async function assertDialogGeometry(page, dialog) {
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: globalThis.innerWidth,
      viewportHeight: globalThis.innerHeight,
      heightRatio: rect.height / globalThis.innerHeight,
      documentWidth: globalThis.document.documentElement.scrollWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.heightRatio).toBeGreaterThan(0.88);
  expect(geometry.heightRatio).toBeLessThan(0.92);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
}

async function captureContent(dialog, name) {
  const content = dialog.locator('.MuiDialogContent-root');
  await expect(content).toHaveScreenshot(`${name}.png`);
  await assertVisibleControlsNotClipped(content);
}

async function captureScrolledEnd(dialog, name) {
  const content = dialog.locator('.MuiDialogContent-root');
  const dimensions = await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {clientHeight: element.clientHeight, scrollHeight: element.scrollHeight};
  });
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(content).toHaveScreenshot(`${name}.png`);
  await assertVisibleControlsNotClipped(content);
}

async function selectTab(dialog, name) {
  const tab = dialog.getByRole('tab', {name});
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const panel = dialog.locator('.MuiDialogContent-root > [role="tabpanel"]:visible');
  await expect(panel).toHaveCount(1);
  await expect(panel).toBeVisible();
  return panel;
}

test('clipping guard rejects a visible control that overflows its visual region', async ({page}) => {
  await page.setContent(`
    <main data-testid="clip-probe" style="position: relative; width: 100px; height: 30px; overflow: visible;">
      <button aria-label="synthetic clipping probe" style="position: absolute; left: 95px; top: 0;">probe</button>
    </main>
  `);
  await expect(page.getByRole('button', {name: 'synthetic clipping probe'})).toBeVisible();
  await expect(findVisibleControlsClippedBy(page.getByTestId('clip-probe'))).resolves.toEqual([
    {name: 'synthetic clipping probe', clipped: true},
  ]);
});

test('default overview locks dialog, empty/denied state, tabs and regions', async ({page}) => {
  const {dialog, pageErrors} = await openFloating(page, {fixture: 'empty-and-denied'});
  await assertTabContract(dialog, false);
  await assertDialogGeometry(page, dialog);
  await assertNoTabOverlap(dialog);
  await expect(dialog.locator('.MuiDialogTitle-root')).toHaveScreenshot('default-overview-header.png');
  await captureContent(dialog, 'default-overview-empty-denied');
  await expect(dialog.getByRole('tab', {name: /西藥 \(0\)/})).toBeVisible();
  await expect(dialog.getByRole('tab', {name: /檢驗 \(0\)/})).toBeVisible();
  const state = await page.evaluate(() => globalThis.__visualHarness.sourceStates);
  expect(state.lab.status).toBe('unauthorized');
  expect(state.imaging.status).toBe('fetch-failure');
  expect(state['patient-identity'].status).toBe('has-data');
  expect(pageErrors).toEqual([]);
});

test('full-spectrum overview preserves hierarchy and reaches its final sections', async ({page}) => {
  const {dialog, pageErrors} = await openFloating(page);
  await expect(dialog.getByText('SYNTHETIC SUMMARY RECORD')).toBeVisible();
  await expect(dialog).toContainText('SYNTHETIC HEPATITIS MARKER');
  await captureContent(dialog, 'full-spectrum-overview');
  await captureScrolledEnd(dialog, 'full-spectrum-overview-bottom');
  await expect(dialog.getByText(/SYNTHETIC ALLERGEN/)).toBeInViewport();
  expect(pageErrors).toEqual([]);
});

test('CKM overview remains a deterministic non-AI view', async ({page}) => {
  const {dialog, pageErrors} = await openFloating(page, {
    variant: 'maximal',
    settingsFixture: 'settings-extremes',
  });
  await assertTabContract(dialog, true);
  await expect(dialog.getByRole('button', {name: /腎臟檢驗報告/})).toBeVisible();
  await expect(dialog).toContainText('SYNTHETIC CHECK 42');
  await expect(dialog.getByRole('row', {name: /癌篩.*SYNTHETIC RESULT/})).toBeVisible();
  await expect(dialog).toContainText('SYNTHETIC HEPATITIS MARKER');
  await expect(dialog.getByRole('row', {name: /UPCR/})).toBeVisible();
  await expect(dialog).toContainText(/近期檢驗\s*-\s*UACR\s*45/);
  await captureContent(dialog, 'ckm-overview');
  expect(pageErrors).toEqual([]);
});

for (const scenario of [
  {name: 'western-list', tab: /西藥 \(/, text: /SYNTHETIC ALPHA/},
  {name: 'western-table', tab: '西藥表格檢視', text: /SYNTHETIC ALPHA/},
  {name: 'chinese-medication', tab: /中藥 \(/, text: /SYNTHETIC FORMULA/},
  {name: 'lab-by-type', tab: /檢驗 \(/, variant: 'layout-by-type', text: /123\.4/},
  {name: 'lab-vertical', tab: /檢驗 \(/, variant: 'layout-vertical', text: /123\.4/},
  {name: 'lab-horizontal', tab: /檢驗 \(/, variant: 'layout-horizontal', text: /123\.4/},
  {name: 'lab-two-column', tab: /檢驗 \(/, variant: 'layout-two-column', text: /123\.4/},
  {name: 'lab-three-column', tab: /檢驗 \(/, variant: 'layout-three-column', text: /123\.4/},
  {name: 'lab-table', tab: '檢驗表格檢視', text: /123\.4/},
  {name: 'leftovers', tab: /餘藥 \(/, text: /SYN-W001/},
]) {
  test(`${scenario.name} has stable visible controls and region baseline`, async ({page}) => {
    const {dialog, pageErrors} = await openFloating(page, {
      variant: scenario.variant,
      settingsFixture: scenario.variant ? 'settings-extremes' : undefined,
    });
    const panel = await selectTab(dialog, scenario.tab);
    await expect(panel.getByText(scenario.text).first()).toBeVisible();
    if (scenario.name === 'lab-table') {
      await expect(panel.getByRole('table', {name: 'lab results table'})).toBeVisible();
    }
    await captureContent(dialog, scenario.name);
    expect(pageErrors).toEqual([]);
  });
}

test('imaging preserves report and pending no-report rows', async ({page}) => {
  const {dialog, pageErrors} = await openFloating(page);
  const panel = await selectTab(dialog, /影像 \(/);
  await expect(panel.getByText('SYNTHETIC CT REPORT').first()).toBeVisible();
  await expect(panel.getByRole('heading', {name: '待取報告 (2)'})).toBeVisible();
  await expect(panel.getByRole('row', {name: /2026\/03\/01.*SYNTHETIC CT/})).toBeVisible();
  await expect(panel.getByRole('heading', {name: '已有報告 (2)'})).toBeVisible();
  await captureContent(dialog, 'imaging-report-and-no-report');
  expect(pageErrors).toEqual([]);
});

test('patient switch replay excludes late A and exposes only current B snapshot', async ({page}) => {
  const {dialog, pageErrors} = await openFloating(page, {fixture: 'patient-switch-race'});
  const replay = await page.evaluate(() => ({
    accepted: globalThis.__visualHarness.acceptedEventSeq,
    rejected: globalThis.__visualHarness.rejectedEventSeq,
    active: globalThis.__visualHarness.activeSessionId,
    labs: globalThis.lastInterceptedLabData.rObject.map((item) => item.order_code),
  }));
  expect(replay).toEqual({
    accepted: [1, 2, 3, 6],
    rejected: [4, 5],
    active: 'fixture-session-race-b',
    labs: ['SYN-CURRENT-B'],
  });
  await expect(dialog).not.toContainText('SYNTHETIC LATE A');
  expect(pageErrors).toEqual([]);
});

test('sparse and malformed replay is safe-empty with no expired residue', async ({page}) => {
  const {dialog, pageErrors} = await openFloating(page, {fixture: 'sparse-and-malformed'});
  const snapshot = await page.evaluate(() => ({
    rejected: globalThis.__visualHarness.rejectedEventSeq,
    active: globalThis.__visualHarness.activeSessionId,
    western: globalThis.lastInterceptedMedicationData.rObject,
    labs: globalThis.lastInterceptedLabData.rObject,
    summary: globalThis.lastInterceptedPatientSummaryData.rObject,
  }));
  expect(snapshot).toEqual({
    rejected: [8],
    active: 'fixture-session-sparse',
    western: [],
    labs: [],
    summary: [],
  });
  await expect(dialog).not.toContainText(/SYNTHETIC PREVIOUS PATIENT STATE|SYNTHETIC EXPIRED SESSION TEXT/);
  await expect(dialog.getByRole('tab', {name: /西藥 \(0\)/})).toBeVisible();
  await expect(dialog.getByRole('tab', {name: /檢驗 \(0\)/})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('boundary fixture uses its fixed clock and locks legacy edge rendering', async ({page}) => {
  const {dialog, pageErrors} = await openFloating(page, {
    fixture: 'boundary-clock',
    variant: 'boundary-defaults',
  });
  const clock = await page.evaluate(() => ({
    fixed: globalThis.__visualHarness.fixedNow,
    now: new Date(Date.now()).toISOString(),
  }));
  expect(clock.fixed).toBe('2026-06-30T12:00:00+08:00');
  expect(clock.now).toBe('2026-06-30T04:00:00.000Z');
  const panel = await selectTab(dialog, /西藥 \(/);
  await expect(panel.getByText('SYN-DAY-14')).toBeVisible();
  await expect(panel.getByText('SYN-DAY-15')).toBeVisible();
  await expect(panel.getByText('SYN-AGE-100')).toBeVisible();
  await expect(panel.getByText('SYN-AGE-101')).toBeVisible();
  await expect(panel.getByRole('heading', {name: '長期用藥（≥14天）'})).toBeVisible();
  const imagingPanel = await selectTab(dialog, /影像 \(/);
  for (const code of ['SYN-CT-90', 'SYN-CT-91', 'SYN-MRI-90', 'SYN-MRI-91', 'SYN-IMG-180', 'SYN-IMG-181']) {
    await expect(imagingPanel.getByText(code)).toBeVisible();
  }
  const labPanel = await selectTab(dialog, /檢驗 \(/);
  await expect(labPanel.getByText(/SYN-LAB-180/)).toBeVisible();
  await expect(labPanel.getByText(/SYN-LAB-181/)).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('Advanced remains conditional and both custom editors are scroll-safe', async ({page}) => {
  const {dialog, pageErrors} = await openFloating(page, {
    variant: 'maximal',
    settingsFixture: 'settings-extremes',
  });
  const panel = await selectTab(dialog, '進階');
  const medicationTab = panel.getByRole('tab', {name: '西藥自訂複製格式'});
  const labTab = panel.getByRole('tab', {name: '檢驗複製格式'});
  await expect(medicationTab).toHaveAttribute('aria-selected', 'true');
  await expect(labTab).toBeVisible();
  await expect(panel.getByRole('button', {name: '重置為預設'})).toBeVisible();
  await expect(panel.getByRole('button', {name: '儲存設定'})).toBeVisible();
  await captureContent(dialog, 'advanced-medication-custom-editor');
  await labTab.click();
  await expect(labTab).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('button', {name: '重置為預設'})).toBeVisible();
  await captureContent(dialog, 'advanced-lab-custom-editor');
  expect(pageErrors).toEqual([]);
});

test('narrow tab strip scrolls by keyboard without overlap or losing end tabs', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1024x768', 'narrow-only characterization');
  const {dialog, pageErrors} = await openFloating(page, {
    variant: 'maximal',
    settingsFixture: 'settings-extremes',
  });
  const scroller = dialog.locator('.MuiTabs-scroller');
  const dimensions = await scroller.evaluate((element) => ({clientWidth: element.clientWidth, scrollWidth: element.scrollWidth}));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  const tabs = dialog.locator('.MuiDialogTitle-root [role="tab"]');
  await tabs.first().focus();
  await page.keyboard.press('End');
  await expect(tabs.last()).toBeFocused();
  await tabs.last().click();
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.last()).toBeInViewport();
  await expect(dialog.locator('.MuiTabs-scrollButtons')).toHaveCount(2);
  await expect(dialog.locator('.MuiDialogTitle-root')).toHaveScreenshot('narrow-tab-scrolling.png');
  await assertNoTabOverlap(dialog);
  expect(pageErrors).toEqual([]);
});

test('settings accordions expose named controls without clipping', async ({page}) => {
  const pageErrors = observePageErrors(page);
  await page.goto('/tests/visual/index.html?surface=popup&fixture=settings-extremes&variant=maximal');
  await expect(page.locator('body')).toHaveAttribute('data-harness-ready', 'true');
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  const shell = page.getByRole('main', {name: '合成設定頁面'});
  await expect(shell.getByRole('tab')).toHaveCount(4);
  for (const [id, slug] of [
    ['general-display-settings-header', 'general'],
    ['cloud-data-settings-header', 'cloud-data'],
    ['overview-settings-header', 'overview'],
    ['medication-settings-header', 'western'],
    ['chinesemed-settings-header', 'chinese'],
    ['lab-settings-header', 'lab'],
    ['advanced-settings-header', 'advanced'],
  ]) {
    const summary = shell.locator(`#${id}`);
    await summary.click();
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await expect(summary).toHaveAccessibleName(/設定|顯示/);
    const accordion = summary.locator('xpath=ancestor::*[contains(@class,"MuiAccordion-root")]');
    await assertVisibleControlsNotClipped(accordion);
    await expect(accordion).toHaveScreenshot(`settings-accordion-${slug}.png`);
    await summary.click();
  }
  for (const id of [
    'floating-icon-position',
    'title-text-size',
    'content-text-size',
    'note-text-size',
    'medication-tracking-days',
    'lab-tracking-days',
    'image-tracking-days',
    'medication-copy-format',
    'chinesemed-dose-format',
    'chinesemed-copy-format',
    'lab-display-format',
    'lab-copy-format',
  ]) {
    await expect(shell.locator(`#${id}`)).toHaveCount(1);
  }
  expect(pageErrors).toEqual([]);
});
