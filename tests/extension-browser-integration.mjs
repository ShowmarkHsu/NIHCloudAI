import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '@playwright/test';

const extensionPath = path.resolve('dist');
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
  if (parentErrors.length > 0) throw new Error(`extension content runtime page errors: ${parentErrors.join('; ')}`);
  console.log('Extension iframe browser integration: built MV3 iframe ignored an untrusted scope and rejected an unsealed scope from an actual NHI-origin parent.');
} finally {
  await context?.close();
  await rm(userDataDirectory, {recursive: true, force: true});
}
