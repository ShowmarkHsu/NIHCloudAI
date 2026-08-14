import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyMaintainedFile, collectLintTargets} from '../../scripts/run-b1-lint.mjs';

test('B1 lint scope includes every current characterization and visual source', () => {
  const targets = collectLintTargets();
  assert.ok(targets.includes('tests/characterization/non-ai-contracts.test.mjs'));
  assert.ok(targets.includes('tests/visual/visual.spec.mjs'));
  assert.ok(targets.includes('tests/visual/src/main.jsx'));
});

test('new maintained B1 and AI files cannot silently escape their gates', () => {
  assert.equal(classifyMaintainedFile('tests/visual/new-visual-test.mjs'), 'eslint');
  assert.equal(classifyMaintainedFile('tests/characterization/new-contract.jsx'), 'eslint');
  assert.equal(classifyMaintainedFile('src/ai/contracts/new-contract.ts'), 'typecheck');
  assert.equal(classifyMaintainedFile('src/ai/release/new-manifest.ts'), 'typecheck');
  assert.equal(classifyMaintainedFile('src/ai/session/new-coordinator.ts'), 'typecheck');
  assert.equal(classifyMaintainedFile('src/background/new-router.ts'), 'typecheck');
  assert.equal(classifyMaintainedFile('tests/ai/contracts/new-contract.test.ts'), 'typecheck');
  assert.equal(classifyMaintainedFile('tests/ai/session/new-coordinator.test.ts'), 'typecheck');
  assert.equal(classifyMaintainedFile('tests/ai/security/new-router.test.ts'), 'typecheck');
  assert.equal(classifyMaintainedFile('src/components/FloatingIcon.jsx'), undefined);
});
