import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = readFileSync(path.join(repositoryRoot, '.github/workflows/release.yml'), 'utf8');
const pullRequestWorkflow = readFileSync(
  path.join(repositoryRoot, '.github/workflows/pull-request.yml'),
  'utf8',
);
const bashExecutable = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

function workflowScript(stepName) {
  const escapedName = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workflow.match(
    new RegExp(`      - name: ${escapedName}\\r?\\n[\\s\\S]*?        run: \\|\\r?\\n([\\s\\S]*?)(?=\\r?\\n      - name:|\\r?\\n  [a-zA-Z0-9_-]+:|$)`),
  );
  assert.ok(match, `workflow step not found: ${stepName}`);
  return match[1].replace(/^ {10}/gm, '');
}

function runTagGate(overrides = {}) {
  const commandFixtures = `
git() {
case "$*" in
  "rev-list -n 1 v0.2.0-rc.3") echo "${overrides.rcSha ?? 'rc-sha'}" ;;
  "rev-list --parents -n 1 stable-sha") echo "stable-sha ${overrides.parents ?? 'rc-sha'}" ;;
  "diff --name-only rc-sha stable-sha") printf '%s\\n' ${overrides.diffFiles ?? 'package.json package-lock.json public/manifest.json'} ;;
  "cat-file -t refs/tags/v0.2.0") echo tag ;;
  "rev-parse refs/tags/v0.2.0^{tag}") echo tag-object-sha ;;
  *) echo "unexpected git invocation: $*" >&2; exit 91 ;;
esac
}
gh() {
case "$*" in
  "release view v0.2.0-rc.3 --json isPrerelease,isDraft") printf '%s\\n' '${overrides.rcReleaseJson ?? '{"isPrerelease":true,"isDraft":false}'}' ;;
  *"repos/ShowmarkHsu/NIHCloudAI/git/tags/tag-object-sha"*) echo '{"verification":{"verified":true}}' ;;
  *"repos/ShowmarkHsu/NIHCloudAI/compare/stable-sha...main"*) echo '{"status":"identical"}' ;;
  "release view v0.2.0") return 1 ;;
  *) echo "unexpected gh invocation: $*" >&2; exit 92 ;;
esac
}
`;

  return spawnSync(bashExecutable, ['-c', `${commandFixtures}\n${workflowScript('Verify canonical release tag')}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'ShowmarkHsu/NIHCloudAI',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v0.2.0',
      GITHUB_SHA: 'stable-sha',
      RELEASE_VERSION: '0.2.0',
      IS_PRERELEASE: 'false',
      APPROVED_RC_TAG: 'v0.2.0-rc.3',
    },
  });
}

function runGovernanceGate(overrides = {}) {
  const commandFixtures = `
gh() {
case "$*" in
  *"repos/ShowmarkHsu/NIHCloudAI/branches/main") printf '%s\\n' '${overrides.mainJson ?? '{"protected":true}'}' ;;
  *"repos/ShowmarkHsu/NIHCloudAI/branches/main/protection") printf '%s\\n' '${overrides.protectionJson ?? '{"required_status_checks":{"strict":true,"contexts":["verify","visual"],"checks":[{"context":"verify"},{"context":"visual"}]}}'}' ;;
  *"repos/ShowmarkHsu/NIHCloudAI/environments/release") printf '%s\\n' '${overrides.environmentJson ?? '{"protection_rules":[{"type":"required_reviewers","reviewers":[{"type":"User","reviewer":{"login":"release-reviewer"}}]}],"prevent_self_review":true}'}' ;;
  *"repos/ShowmarkHsu/NIHCloudAI/immutable-releases") printf '%s\\n' '${overrides.immutableJson ?? '{"enabled":true,"enforced_by_owner":false}'}' ;;
  *"repos/ShowmarkHsu/NIHCloudAI/rulesets?per_page=100") printf '%s\\n' '${overrides.rulesetsJson ?? '[{"id":7}]'}' ;;
  *"repos/ShowmarkHsu/NIHCloudAI/rulesets/7") printf '%s\\n' '${overrides.rulesetJson ?? '{"target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"bypass_actors":[{"actor_type":"User","actor_id":12873164,"bypass_mode":"always"}],"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}]}'}' ;;
  *) echo "unexpected gh invocation: $*" >&2; exit 92 ;;
esac
}
`;

  return spawnSync(bashExecutable, ['-c', `${commandFixtures}\n${workflowScript('Verify release governance')}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'ShowmarkHsu/NIHCloudAI',
      GH_TOKEN: overrides.token ?? 'governance-read-token',
    },
  });
}

test('stable promotion accepts a direct child of the approved published RC', () => {
  const result = runTagGate();
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test('stable promotion rejects a commit that is not the direct child of the approved RC', () => {
  assert.notEqual(runTagGate({ parents: 'other-sha' }).status, 0);
});

test('stable promotion rejects changes outside the three version identity files', () => {
  const result = runTagGate({ diffFiles: 'package.json src/App.jsx' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden file/);
});

test('stable promotion rejects a draft prerelease as an approved RC', () => {
  const result = runTagGate({ rcReleaseJson: '{"isPrerelease":true,"isDraft":true}' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /approved RC must be a published prerelease/);
});

test('release governance accepts all required controls', () => {
  const result = runGovernanceGate();
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test('release governance fails closed without an environment required reviewer', () => {
  const result = runGovernanceGate({ environmentJson: '{"protection_rules":[]}' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release environment has no required reviewer/);
});

test('release governance fails closed without strict required status checks', () => {
  const result = runGovernanceGate({
    protectionJson: '{"required_status_checks":{"strict":false,"contexts":[],"checks":[]}}',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must strictly require verify and visual checks/);
});

test('release governance fails closed when an approved required check is missing', () => {
  const result = runGovernanceGate({
    protectionJson: '{"required_status_checks":{"strict":true,"contexts":["unrelated"],"checks":[{"context":"verify"}]}}',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must strictly require verify and visual checks/);
});

test('release governance fails closed when immutable releases are disabled', () => {
  const result = runGovernanceGate({ immutableJson: '{"enabled":false,"enforced_by_owner":false}' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /immutable releases are not enabled/);
});

test('release governance fails closed without an active controlled v-star tag ruleset', () => {
  const result = runGovernanceGate({
    rulesetJson: '{"target":"tag","enforcement":"disabled","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"bypass_actors":[],"rules":[]}',
  });
  assert.notEqual(result.status, 0);
});

test('release governance rejects a v-star ruleset bypassable by another actor', () => {
  const result = runGovernanceGate({
    rulesetJson: '{"target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"bypass_actors":[{"actor_type":"User","actor_id":12873164,"bypass_mode":"always"},{"actor_type":"User","actor_id":7,"bypass_mode":"always"}],"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}]}',
  });
  assert.notEqual(result.status, 0);
});

test('release governance fails closed without its read token', () => {
  assert.notEqual(runGovernanceGate({ token: '' }).status, 0);
});

test('pull request workflow exposes the exact required verify and visual checks', () => {
  assert.match(pullRequestWorkflow, /^\s{2}pull_request:\s*$/m);
  assert.match(pullRequestWorkflow, /^\s{2}verify:\s*\r?\n\s{4}name: verify$/m);
  assert.match(pullRequestWorkflow, /^\s{2}visual:\s*\r?\n\s{4}name: visual$/m);
  assert.match(pullRequestWorkflow, /run: npm run verify/);
  assert.match(pullRequestWorkflow, /run: npm run test:visual/);
});

test('pull request verify check fetches full history for canonical provenance', () => {
  const verifyJob = pullRequestWorkflow.match(/  verify:[\s\S]*?(?=\n  visual:)/)?.[0];
  assert.ok(verifyJob);
  assert.match(verifyJob, /fetch-depth: 0/);
});

test('pull request verify check installs Chromium before browser verification', () => {
  const verifyJob = pullRequestWorkflow.match(/  verify:[\s\S]*?(?=\n  visual:)/)?.[0];
  assert.ok(verifyJob);
  assert.match(verifyJob, /run: npx playwright install chromium/);
  assert.ok(
    verifyJob.indexOf('npx playwright install chromium') < verifyJob.indexOf('npm run verify'),
  );
});

test('release environment approval protects the job before artifact creation', () => {
  const verifyJob = workflow.match(/  verify-and-package:[\s\S]*?(?=\n  create-draft-release:)/)?.[0];
  assert.ok(verifyJob);
  assert.match(verifyJob, /^\s{4}environment: release$/m);
  assert.ok(
    verifyJob.indexOf('environment: release') < verifyJob.indexOf('Create immutable release artifact'),
  );
});
