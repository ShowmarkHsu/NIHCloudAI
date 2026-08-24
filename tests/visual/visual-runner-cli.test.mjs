import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('the visual CLI owns its server lifecycle and exits after one completed case', () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['test:visual'],
    'node --test tests/visual/visual-runner-cli.test.mjs && node scripts/run-visual-tests.mjs',
  );

  const result = spawnSync(process.execPath, [
    'scripts/run-visual-tests.mjs',
    '--grep',
    'clipping guard',
    '--project=desktop-1440x900',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {...process.env, CI: ''},
    timeout: 20_000,
    windowsHide: true,
  });

  assert.notEqual(result.error?.code, 'ETIMEDOUT', 'visual CLI did not exit within 20 seconds');
  assert.equal(result.status, 0, 'visual CLI did not exit successfully');
});
