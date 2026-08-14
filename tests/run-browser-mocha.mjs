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
  await page.waitForSelector('#mocha-stats.pass', {timeout: 60_000});
  const stats = await page.evaluate(() => {
    const value = (selector) => Number(globalThis.document.querySelector(selector)?.textContent || 0);
    return {
      passes: value('#mocha-stats .passes em'),
      failures: value('#mocha-stats .failures em'),
      pending: value('#mocha-stats .pending em'),
      duration: globalThis.document.querySelector('#mocha-stats .duration em')?.textContent || '0',
    };
  });
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
