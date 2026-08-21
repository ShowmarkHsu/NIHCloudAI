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
  console.log('Extension iframe browser integration: built MV3 iframe ignored an untrusted scope and rejected an unsealed trusted scope.');
} finally {
  await context?.close();
  await rm(userDataDirectory, {recursive: true, force: true});
}
