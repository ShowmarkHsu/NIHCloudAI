import {spawn} from 'node:child_process';
import {once} from 'node:events';
import process from 'node:process';
import {chromium} from '@playwright/test';

const port = 4175;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['tests/serve.js', '--port', String(port)], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Mocha server exited early.\n${serverLog}`);
    try {
      const response = await globalThis.fetch(`${baseUrl}/test.html`);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for the Mocha server.\n${serverLog}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage({locale: 'zh-TW'});
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/test.html`);
  try {
    await page.waitForFunction(
      () => globalThis.__browserMochaResult !== undefined,
      null,
      {timeout: 60_000},
    );
  } catch (error) {
    const pageState = await page.evaluate(() => ({
      readyState: globalThis.document.readyState,
      result: globalThis.__browserMochaResult ?? null,
      statsText: globalThis.document.querySelector('#mocha-stats')?.textContent?.trim() ?? null,
      unfinishedTests: [...globalThis.document.querySelectorAll('#mocha-report .test')]
        .filter((node) => !node.classList.contains('pass') && !node.classList.contains('fail') && !node.classList.contains('pending'))
        .map((node) => node.textContent?.trim() ?? ''),
      bootstrap: {
        mocha: typeof globalThis.mocha,
        testModule: globalThis.document.querySelector('script[src$="test.js"]') !== null,
      },
    }));
    throw new Error(
      `Browser Mocha did not complete: ${JSON.stringify({pageErrors, pageState, serverLog})}`,
      {cause: error},
    );
  }
  const stats = await page.evaluate(() => globalThis.__browserMochaResult);
  if (stats.failures !== 0 || pageErrors.length > 0) {
    throw new Error(`Browser Mocha failed: ${JSON.stringify({stats, pageErrors})}`);
  }
  globalThis.console.log(`Browser Mocha: ${stats.passes} passed, ${stats.pending} pending (${stats.duration} s)`);
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
  await Promise.race([
    once(server, 'exit'),
    new Promise((resolve) => globalThis.setTimeout(resolve, 2_000)),
  ]);
}
