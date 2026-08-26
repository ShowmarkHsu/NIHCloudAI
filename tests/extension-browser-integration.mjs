import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '@playwright/test';

const runRealOllamaUi = process.argv.includes('--real-ollama-ui');

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

let ollamaBridgeServer;
let ollamaBridgeOrigin;
if (runRealOllamaUi) {
  ollamaBridgeServer = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/api/generate') {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    let byteLength = 0;
    for await (const chunk of request) {
      byteLength += chunk.length;
      if (byteLength > 1_000_000) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    try {
      const upstream = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: Buffer.concat(chunks),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      response.end(body);
    } catch {
      response.writeHead(502).end();
    }
  });
  ollamaBridgeServer.listen(0, '127.0.0.1');
  await once(ollamaBridgeServer, 'listening');
  const ollamaBridgeAddress = ollamaBridgeServer.address();
  if (ollamaBridgeAddress === null || typeof ollamaBridgeAddress === 'string') {
    throw new Error('controlled Ollama bridge did not expose a TCP address');
  }
  ollamaBridgeOrigin = `http://127.0.0.1:${ollamaBridgeAddress.port}`;
}

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
if (runRealOllamaUi) {
  manifest.host_permissions.push('http://127.0.0.1:11434/*');
  manifest.host_permissions.push(`${ollamaBridgeOrigin}/*`);
  manifest.optional_host_permissions = manifest.optional_host_permissions.filter(
    (origin) => origin !== 'http://127.0.0.1:11434/*',
  );
}
await writeFile(manifestPath, JSON.stringify(manifest));
const backgroundPath = path.join(extensionPath, 'background.js');
const backgroundSource = await readFile(backgroundPath, 'utf8');
let rewrittenBackgroundSource = backgroundSource.replace(
  'https://openrouter.ai/api/v1/chat/completions',
  syntheticProviderEndpoint,
);
if (rewrittenBackgroundSource === backgroundSource) {
  throw new Error('built background did not contain the fixed OpenRouter endpoint');
}
if (runRealOllamaUi) {
  const ollamaBridgeEndpoint = `${ollamaBridgeOrigin}/api/generate`;
  const ollamaRewrittenBackgroundSource = rewrittenBackgroundSource.replace(
    'http://127.0.0.1:11434/api/generate',
    ollamaBridgeEndpoint,
  );
  if (ollamaRewrittenBackgroundSource === rewrittenBackgroundSource) {
    throw new Error('built background did not contain the fixed Ollama endpoint');
  }
  rewrittenBackgroundSource = ollamaRewrittenBackgroundSource;
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
  await liveParent.waitForTimeout(100);
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
  await liveParent.waitForTimeout(100);
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
  await liveParent.waitForTimeout(500);
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
  const copyButton = liveFrame.getByRole('button', {name: '複製已 review 摘要'});
  if (await copyButton.isEnabled()) {
    throw new Error('MV3 summary copy must remain disabled before review');
  }

  const browser = context.browser();
  if (browser === null) throw new Error('persistent browser context is unavailable');
  const cdp = await browser.newBrowserCDPSession();
  const {targetInfos} = await cdp.send('Target.getTargets');
  const serviceWorkerTarget = targetInfos.find((target) =>
    target.type === 'service_worker' && target.url === worker.url());
  if (serviceWorkerTarget === undefined) {
    throw new Error('built MV3 service worker target is unavailable');
  }
  await cdp.send('Target.closeTarget', {targetId: serviceWorkerTarget.targetId});
  await cdp.detach();

  await liveFrame.getByRole('button', {name: '確認 review'}).click();
  const reviewPreserved = await providerStatus.evaluate((element) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const poll = () => {
      if (element.textContent === '已 review；可複製目前版本。') {
        resolve(true);
      } else if (element.textContent === '資料工作階段已變更；舊快照與摘要不可使用。') {
        resolve(false);
      } else if (Date.now() >= deadline) {
        reject(new Error('review did not preserve the completed current summary'));
      } else {
        setTimeout(poll, 25);
      }
    };
    poll();
  }));
  if (!reviewPreserved) {
    throw new Error('MV3 service-worker restart made the current summary stale at review');
  }
  if (!(await copyButton.isEnabled())) {
    throw new Error('MV3 summary copy did not become eligible after review');
  }
  const medicationCoverage = await liveFrame.getByLabel('目前用藥與過敏 內容').inputValue();
  if (medicationCoverage !== '西藥：資料缺口，待確認；中藥：資料缺口，待確認；過敏：資料缺口，待確認。') {
    throw new Error('MV3 summary did not use the deterministic local medication/allergy coverage rendering');
  }
  const dischargeCoverage = await liveFrame.getByLabel('住院、手術與出院 內容').inputValue();
  if (dischargeCoverage !== '就醫：資料缺口，待確認；處置：資料缺口，待確認；出院：資料缺口，待確認。') {
    throw new Error('MV3 summary did not use the deterministic local admission/procedure/discharge coverage rendering');
  }
  if (!receivedSyntheticProviderRequest) {
    throw new Error('OpenRouter request did not leave the MV3 background service worker');
  }

  if (runRealOllamaUi) {
    for (let run = 1; run <= 3; run += 1) {
      const ollamaParent = await context.newPage();
      const ollamaPageErrors = [];
      ollamaParent.on('pageerror', () => ollamaPageErrors.push('page-error'));
      try {
        await ollamaParent.route('https://medcloud2.nhi.gov.tw/**', (route) => route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>controlled synthetic Ollama parent</title><body></body>',
        }));
        await ollamaParent.goto(`https://medcloud2.nhi.gov.tw/controlled-ollama-has-data-ui-${run}`);
        const ollamaFloatingButton = ollamaParent.locator('#nhi-floating-root button').filter({
          has: ollamaParent.locator('img[alt="NHI Extractor"]'),
        });
        await ollamaFloatingButton.waitFor({timeout: 15_000});
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await ollamaParent.evaluate(() => {
            window.dispatchEvent(new CustomEvent('dataFetchCompleted', {detail: [{
              status: 'success', dataType: 'labdata', recordCount: 1,
              data: {rObject: [{
                hosp: 'Synthetic Lab;outpatient;0000000000', real_inspect_date: '2026/08/26',
                order_code: 'LAB-OLLAMA-001', assay_item_name: 'Synthetic analyte', assay_value: '12.3',
                unit_data: 'mg/dL', consult_value: '10-14', assay_mark: 'H',
              }]},
            }]}));
          });
          await ollamaParent.waitForTimeout(100);
        }
        await ollamaFloatingButton.click();
        await ollamaParent.getByRole('tab', {name: 'AI 摘要'}).click();
        const ollamaFrame = ollamaParent.frameLocator('iframe[title="AI 摘要隔離工作區"]');
        await ollamaFrame.getByText('資料已就緒；請主動選擇 provider。').waitFor({timeout: 15_000});
        await ollamaFrame.getByRole('button', {name: '生成本機 Ollama 摘要'}).click();
        const ollamaStatus = ollamaFrame.locator('p[aria-live="polite"]');
        await ollamaStatus.evaluate((element) => new Promise((resolve, reject) => {
          const deadline = Date.now() + 190_000;
          const pendingStates = new Set([
            '資料已就緒；請主動選擇 provider。',
            '正在生成完整摘要；不會顯示 partial output。',
          ]);
          const poll = () => {
            if (!pendingStates.has(element.textContent)) resolve();
            else if (Date.now() >= deadline) reject(new Error('Ollama UI status remained pending'));
            else setTimeout(poll, 50);
          };
          poll();
        }));
        const ollamaStatusText = await ollamaStatus.textContent();
        if (ollamaStatusText !== '完整摘要已通過固定格式驗證，請 review。') {
          throw new Error(`controlled Ollama UI failed closed: ${ollamaStatusText}`);
        }
        const ollamaCopyButton = ollamaFrame.getByRole('button', {name: '複製已 review 摘要'});
        if (await ollamaCopyButton.isEnabled()) {
          throw new Error('controlled Ollama UI copy must remain disabled before review');
        }
        await ollamaFrame.getByRole('button', {name: '確認 review'}).click();
        await ollamaFrame.getByText('已 review；可複製目前版本。').waitFor({timeout: 15_000});
        if (!(await ollamaCopyButton.isEnabled())) {
          throw new Error('controlled Ollama UI copy did not become eligible after review');
        }
        if (ollamaPageErrors.length > 0) {
          throw new Error('controlled Ollama UI page reported an error');
        }
      } finally {
        await ollamaParent.close();
      }
    }
    console.log('Controlled Ollama UI: 3/3 fresh synthetic has-data sessions passed full validation and review/copy gating.');
  }
  if (parentErrors.length > 0) throw new Error(`extension content runtime page errors: ${parentErrors.join('; ')}`);
  console.log('Extension iframe browser integration: built MV3 iframe failed closed for invalid scopes and completed a synthetic loopback Provider round trip.');
} finally {
  await context?.close();
  await rm(userDataDirectory, {recursive: true, force: true});
  await rm(extensionPath, {recursive: true, force: true});
  await new Promise((resolve) => providerServer.close(resolve));
  if (ollamaBridgeServer !== undefined) {
    await new Promise((resolve) => ollamaBridgeServer.close(resolve));
  }
}
