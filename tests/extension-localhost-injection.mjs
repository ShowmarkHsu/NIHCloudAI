import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {chromium} from '@playwright/test';

const server = createServer((_request, response) => {
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end('<!doctype html><html><head><title>synthetic localhost extension test</title></head><body></body></html>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (address === null || typeof address === 'string') {
  throw new Error('synthetic localhost server did not expose a TCP address');
}

const extensionPath = await mkdtemp(path.join(os.tmpdir(), 'nihcloudai-localhost-extension-'));
const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'nihcloudai-localhost-browser-'));
let context;

try {
  await cp(path.resolve('dist'), extensionPath, {recursive: true});
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions.push('http://localhost/*');
  manifest.content_scripts[0].matches.push('http://localhost/*');
  manifest.web_accessible_resources[0].matches.push('http://localhost/*');
  await writeFile(manifestPath, JSON.stringify(manifest));

  context = await chromium.launchPersistentContext(userDataDirectory, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent('serviceworker', {timeout: 15_000});
  }

  const page = await context.newPage();
  await page.goto(`http://localhost:${address.port}/`);
  try {
    await page.locator('#nhi-floating-root').waitFor({state: 'attached', timeout: 5_000});
  } catch {
    throw new Error('localhost test-build content script did not attach #nhi-floating-root');
  }

  const emittedSealedSnapshot = await page.evaluate(async () => {
    let sealed = false;
    globalThis.addEventListener('ai.lab-snapshot.sealed', () => { sealed = true; }, {once: true});
    globalThis.dispatchEvent(new CustomEvent('dataFetchCompleted', {detail: [{
      status: 'success', dataType: 'labdata', recordCount: 0, data: {rObject: []},
    }]}));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    return sealed;
  });
  if (emittedSealedSnapshot) {
    throw new Error('localhost test-build must not activate the fixed-origin AI data-session runtime');
  }

  console.log('Extension localhost injection: test-build content script attached its legacy root while the NHI-only AI runtime remained inactive.');
} finally {
  await context?.close();
  await rm(userDataDirectory, {recursive: true, force: true});
  await rm(extensionPath, {recursive: true, force: true});
  await new Promise((resolve) => server.close(resolve));
}
