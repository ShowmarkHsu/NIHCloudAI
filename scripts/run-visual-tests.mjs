import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const vitePackage = require.resolve('vite/package.json');
const viteCli = path.join(path.dirname(vitePackage), 'bin', 'vite.js');
const visualUrl = 'http://127.0.0.1:4174/tests/visual/index.html';
const startupTimeoutMs = 120_000;
const shutdownTimeoutMs = 5_000;

let activeServer;
let activePlaywright;

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({code: child.exitCode, signal: child.signalCode});
  }
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({code, signal}));
  });
}

async function urlIsReady() {
  try {
    const response = await fetch(visualUrl, {signal: AbortSignal.timeout(1_000)});
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + startupTimeoutMs;
  let startupError;
  server.once('error', (error) => {
    startupError = error;
  });
  while (Date.now() < deadline) {
    if (startupError !== undefined) throw startupError;
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error('Visual server exited before becoming ready.');
    }
    if (await urlIsReady()) return;
    await delay(100);
  }
  throw new Error('Visual server did not become ready within 120 seconds.');
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = waitForExit(server);
  server.kill();
  const firstResult = await Promise.race([
    exited.then(() => true),
    delay(shutdownTimeoutMs).then(() => false),
  ]);
  if (firstResult) return;

  server.kill('SIGKILL');
  const forcedResult = await Promise.race([
    exited.then(() => true),
    delay(shutdownTimeoutMs).then(() => false),
  ]);
  if (!forcedResult) throw new Error('Visual server did not exit after direct termination.');
}

async function run() {
  let ownsServer = false;
  if (await urlIsReady()) {
    if (process.env.CI) throw new Error(`Visual server is already running at ${visualUrl}.`);
  } else {
    activeServer = spawn(process.execPath, [viteCli, '--config', 'vite.visual.config.js'], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    ownsServer = true;
    await waitForServer(activeServer);
  }

  try {
    activePlaywright = spawn(process.execPath, [
      playwrightCli,
      'test',
      ...process.argv.slice(2),
    ], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    const result = await waitForExit(activePlaywright);
    return result.code ?? 1;
  } finally {
    activePlaywright = undefined;
    if (ownsServer && activeServer !== undefined) await stopServer(activeServer);
    activeServer = undefined;
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    activePlaywright?.kill(signal);
    activeServer?.kill();
  });
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Visual runner failed.');
  process.exitCode = 1;
}
