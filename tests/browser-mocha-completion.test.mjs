import {spawn} from 'node:child_process';
import {once} from 'node:events';
import process from 'node:process';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from '@playwright/test';

const port = 4186;
const baseUrl = `http://127.0.0.1:${port}`;

test('browser mocha exposes an explicit completion signal', async (t) => {
  const server = spawn(process.execPath, ['tests/serve.js', '--port', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(async () => {
    if (server.exitCode === null) server.kill();
    await Promise.race([
      once(server, 'exit'),
      new Promise((resolve) => globalThis.setTimeout(resolve, 2_000)),
    ]);
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/test.html`)).ok) break;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
  }

  const browser = await chromium.launch({headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/test.html`);

  await page.waitForFunction(() => globalThis.__browserMochaResult !== undefined, null, {
    timeout: 3_000,
  });
  const result = await page.evaluate(() => globalThis.__browserMochaResult);
  assert.deepEqual(pageErrors, []);
  assert.equal(result.failures, 0);
  assert.equal(result.passes, 106);
  assert.equal(result.pending, 0);
});
