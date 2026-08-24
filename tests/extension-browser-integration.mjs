import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '@playwright/test';

const providerOutput = JSON.stringify({
  schemaVersion: 'clinical-summary.v1',
  timeWindows: {
    medicationsAndAllergies: 'current-available-data',
    recentCourseAndTests: 'past-90-days',
    admissionsProceduresAndDischarge: 'past-1-year',
  },
  sections: [
    {heading: '核對重點', content: '重'.repeat(40), sourceAliases: ['S1']},
    {heading: '目前用藥與過敏', content: '要'.repeat(40), sourceAliases: ['S1']},
    {heading: '近期病程與檢查', content: '點'.repeat(40), sourceAliases: ['S1']},
    {heading: '住院、手術與出院', content: '資'.repeat(40), sourceAliases: []},
    {heading: '資料缺口與待確認', content: `資料缺口：${'待'.repeat(40)}；待確認：${'核'.repeat(40)}`, sourceAliases: []},
  ],
});
let receivedSyntheticProviderRequest = false;
const providerServer = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/api/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  receivedSyntheticProviderRequest = true;
  request.resume();
  response.writeHead(200, {'content-type': 'application/json'});
  response.end(JSON.stringify({choices: [{message: {content: providerOutput}}]}));
});
providerServer.listen(0, '127.0.0.1');
await once(providerServer, 'listening');
const providerAddress = providerServer.address();
if (providerAddress === null || typeof providerAddress === 'string') {
  throw new Error('synthetic provider server did not expose a TCP address');
}
const syntheticProviderOrigin = `http://127.0.0.1:${providerAddress.port}`;
const syntheticProviderEndpoint = `${syntheticProviderOrigin}/api/v1/chat/completions`;

const builtExtensionPath = path.resolve('dist');
const extensionPath = await mkdtemp(path.join(os.tmpdir(), 'nihcloudai-extension-artifact-'));
await cp(builtExtensionPath, extensionPath, {recursive: true});
// Keep the production dist untouched. The isolated copy pre-grants only the
// fixed OpenRouter host and rewrites only its fixed endpoint to a loopback
// responder so the MV3 transport seam is deterministic and sends no data out.
const manifestPath = path.join(extensionPath, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.host_permissions.push('https://openrouter.ai/*');
manifest.host_permissions.push(`${syntheticProviderOrigin}/*`);
manifest.optional_host_permissions = manifest.optional_host_permissions.filter(
  (origin) => origin !== 'https://openrouter.ai/*',
);
await writeFile(manifestPath, JSON.stringify(manifest));
const backgroundPath = path.join(extensionPath, 'background.js');
const backgroundSource = await readFile(backgroundPath, 'utf8');
const rewrittenBackgroundSource = backgroundSource.replace(
  'https://openrouter.ai/api/v1/chat/completions',
  syntheticProviderEndpoint,
);
if (rewrittenBackgroundSource === backgroundSource) {
  throw new Error('built background did not contain the fixed OpenRouter endpoint');
}
await writeFile(backgroundPath, rewrittenBackgroundSource);
const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'nihcloudai-extension-browser-'));
let context;

try {
  context = await chromium.launchPersistentContext(userDataDirectory, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let worker = context.serviceWorkers()[0];
  if (worker === undefined) {
    worker = await context.waitForEvent('serviceworker', {timeout: 15_000});
  }
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/ai-frame.html`);
  await page.getByRole('heading', {name: 'AI 摘要隔離工作區'}).waitFor({timeout: 15_000});

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://untrusted.example',
      source: window,
      data: {
        type: 'nihcloudai.ai-frame.scope.v1',
        sessionId: 'ds_extension_browser_00001',
        revision: 1,
        contractVersion: 'clinical-projection.v1',
      },
    }));
  });
  await page.getByText('等待目前資料工作階段。').waitFor({timeout: 15_000});

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://medcloud2.nhi.gov.tw',
      source: window,
      data: {
        type: 'nihcloudai.ai-frame.scope.v1',
        sessionId: 'ds_extension_browser_00001',
        revision: 1,
        contractVersion: 'clinical-projection.v1',
      },
    }));
  });
  await page.getByText('資料工作階段已變更；舊快照與摘要不可使用。').waitFor({timeout: 15_000});
  if (pageErrors.length > 0) throw new Error(`extension iframe page errors: ${pageErrors.join('; ')}`);

  const parent = await context.newPage();
  const parentErrors = [];
  parent.on('pageerror', (error) => parentErrors.push(error.message));
  await parent.route('https://medcloud2.nhi.gov.tw/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>controlled synthetic parent</title><body></body>',
  }));
  await parent.goto('https://medcloud2.nhi.gov.tw/controlled-extension-frame-test');
  await parent.evaluate((frameUrl) => {
    const frame = document.createElement('iframe');
    frame.id = 'extension-ai-frame';
    frame.src = frameUrl;
    document.body.append(frame);
  }, `chrome-extension://${extensionId}/ai-frame.html`);
  const embeddedFrame = parent.frameLocator('#extension-ai-frame');
  await embeddedFrame.getByRole('heading', {name: 'AI 摘要隔離工作區'}).waitFor({timeout: 15_000});
  await parent.locator('#extension-ai-frame').evaluate((element) => {
    element.contentWindow.postMessage({
      type: 'nihcloudai.ai-frame.scope.v1',
      sessionId: 'ds_extension_browser_00001',
      revision: 1,
      contractVersion: 'clinical-projection.v1',
    }, new URL(element.src).origin);
  });
  await embeddedFrame.getByText('資料工作階段已變更；舊快照與摘要不可使用。').waitFor({timeout: 15_000});
  if (parentErrors.length > 0) throw new Error(`extension parent page errors: ${parentErrors.join('; ')}`);

  const liveParent = parent;
  await liveParent.goto('https://medcloud2.nhi.gov.tw/controlled-content-runtime-test');
  const floatingButton = liveParent.locator('#nhi-floating-root button').filter({has: liveParent.locator('img[alt="NHI Extractor"]')});
  await floatingButton.waitFor({timeout: 15_000});
  await liveParent.evaluate(() => {
    window.dispatchEvent(new CustomEvent('dataFetchCompleted', {detail: [{
      status: 'success', dataType: 'labdata', recordCount: 1,
      data: {rObject: [{
        hosp: 'Synthetic Lab;outpatient;0000000000', real_inspect_date: '2026/08/24',
        order_code: 'LAB-001', assay_item_name: 'Synthetic analyte', assay_value: '1.0',
        unit_data: 'mg/dL', consult_value: '0-2', assay_mark: '0',
      }]},
    }]}));
  });
  await floatingButton.click();
  await liveParent.getByRole('tab', {name: 'AI 摘要'}).click();
  const liveFrame = liveParent.frameLocator('iframe[title="AI 摘要隔離工作區"]');
  await liveFrame.getByText('資料已就緒；請主動選擇 provider。').waitFor({timeout: 15_000});
  if (await liveParent.getByText('尚未建立可用資料工作階段，無法生成摘要。').count() !== 0) {
    throw new Error('AI tab must not show a missing-session state while its isolated iframe is ready');
  }
  await liveParent.getByText('已建立隔離資料工作階段；請在下方工作區選擇 provider。').waitFor({timeout: 15_000});
  await liveParent.evaluate(() => {
    window.dispatchEvent(new CustomEvent('dataFetchCompleted', {detail: [{
      status: 'success', dataType: 'unrelated', recordCount: 1,
    }]}));
  });
  await liveFrame.getByText('資料已就緒；請主動選擇 provider。').waitFor({timeout: 15_000});

  await liveFrame.getByLabel('本次 session 的 OpenRouter BYOK').fill('synthetic-browser-byok');
  await liveFrame.getByLabel('我同意將此 sealed snapshot 傳送至固定的 OpenRouter route。').check();
  await liveFrame.getByRole('button', {name: '生成遠端 OpenRouter 摘要'}).click();
  const providerStatus = liveFrame.locator('p[aria-live="polite"]');
  await providerStatus.waitFor({timeout: 15_000});
  await providerStatus.evaluate((element) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const pendingStates = new Set([
      '資料已就緒；請主動選擇 provider。',
      '正在生成完整摘要；不會顯示 partial output。',
    ]);
    const poll = () => {
      if (!pendingStates.has(element.textContent)) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error('provider status remained pending'));
      } else {
        setTimeout(poll, 25);
      }
    };
    poll();
  }));
  const providerStatusText = await providerStatus.textContent();
  if (providerStatusText !== '完整摘要已通過固定格式驗證，請 review。') {
    throw new Error(`MV3 OpenRouter transport loop failed closed: ${providerStatusText}`);
  }
  if (!receivedSyntheticProviderRequest) {
    throw new Error('OpenRouter request did not leave the MV3 background service worker');
  }
  if (parentErrors.length > 0) throw new Error(`extension content runtime page errors: ${parentErrors.join('; ')}`);
  console.log('Extension iframe browser integration: built MV3 iframe failed closed for invalid scopes and completed a synthetic loopback Provider round trip.');
} finally {
  await context?.close();
  await rm(userDataDirectory, {recursive: true, force: true});
  await rm(extensionPath, {recursive: true, force: true});
  await new Promise((resolve) => providerServer.close(resolve));
}
