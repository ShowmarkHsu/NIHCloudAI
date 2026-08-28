import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

const EXPECTED = Object.freeze({
  upstreamRepository: 'https://github.com/leescot/NHITW_cloud_analyzer_react_MUI.git',
  upstreamCommit: 'cad76e59c60eafc2947939fc44d7683ba9f7ab9d',
  upstreamVersion: '26.0702.1',
  sourceRepository: 'https://github.com/ShowmarkHsu/NIHCloudAI.git',
  sourceCommit: 'bab69c741e1f6a5b2da65276ce8fe955973e05ca',
  targetRepository: 'https://github.com/ShowmarkHsu/NHITW_cloud_analyzer_react_MUI.git',
  remoteTopologyStatus: 'verified-final-fork-accessible',
});

const baseline = JSON.parse(await readFile(new URL('../docs/upstream-sync/baseline.json', import.meta.url)));
const baselineSchema = JSON.parse(await readFile(new URL('../docs/upstream-sync/baseline.schema.json', import.meta.url)));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const licenseBytes = await readFile(new URL('../LICENSE', import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, keys, path) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${path} keys differ: ${actual.join(', ')}`);
}

assertExactKeys(baseline, ['$schema', 'schemaVersion', 'capturedAt', 'product', 'upstream', 'nicloudaiSource', 'remoteTopology'], 'baseline');
assertExactKeys(baseline.product, ['name', 'repositoryTarget'], 'product');
assertExactKeys(baseline.upstream, ['repository', 'commit', 'version', 'license'], 'upstream');
assertExactKeys(baseline.upstream.license, ['spdx', 'path', 'sha256'], 'upstream.license');
assertExactKeys(baseline.nicloudaiSource, ['repository', 'commit'], 'nicloudaiSource');
assertExactKeys(baseline.remoteTopology, ['verificationStatus', 'checkedAt', 'roles'], 'remoteTopology');
assertExactKeys(baseline.remoteTopology.roles, ['origin', 'upstream', 'nicloudai'], 'remoteTopology.roles');
for (const [name, role] of Object.entries(baseline.remoteTopology.roles)) {
  assertExactKeys(role, ['repository', 'configured', 'readable', 'writable', 'note'], `remoteTopology.roles.${name}`);
  assert(typeof role.configured === 'boolean', `${name}.configured must be boolean`);
  assert(typeof role.readable === 'boolean', `${name}.readable must be boolean`);
  assert(typeof role.writable === 'boolean', `${name}.writable must be boolean`);
  assert(typeof role.note === 'string' && role.note.length > 0, `${name}.note is required`);
}

assert(baseline.$schema === './baseline.schema.json', 'unexpected schema reference');
assert(baseline.schemaVersion === 1, 'unexpected schema version');
assert(
  baselineSchema.$defs.remoteTopology.properties.verificationStatus.enum.includes(
    baseline.remoteTopology.verificationStatus,
  ),
  'remote topology status is not allowed by baseline.schema.json',
);
assert(
  baseline.remoteTopology.verificationStatus === EXPECTED.remoteTopologyStatus,
  'remote topology verification status drifted',
);
assert(/^\d{4}-\d{2}-\d{2}$/.test(baseline.capturedAt), 'capturedAt must be an ISO date');
assert(baseline.product.name === 'NIHCloudAI', 'product name must be NIHCloudAI');
assert(baseline.product.repositoryTarget === EXPECTED.targetRepository, 'target repository drifted');
assert(baseline.upstream.repository === EXPECTED.upstreamRepository, 'upstream repository drifted');
assert(baseline.upstream.commit === EXPECTED.upstreamCommit, 'upstream commit drifted');
assert(baseline.upstream.version === EXPECTED.upstreamVersion, 'upstream version drifted');
assert(baseline.upstream.license.spdx === 'Apache-2.0', 'license must remain Apache-2.0');
assert(baseline.nicloudaiSource.repository === EXPECTED.sourceRepository, 'NIHCloudAI source repository drifted');
assert(baseline.nicloudaiSource.commit === EXPECTED.sourceCommit, 'NIHCloudAI source commit drifted');
assert(packageJson.version === EXPECTED.upstreamVersion, 'package version no longer matches the fixed upstream baseline');
assert(packageJson.repository.url === EXPECTED.targetRepository, 'package repository metadata drifted');

const licenseHash = createHash('sha256').update(licenseBytes).digest('hex');
assert(licenseHash === baseline.upstream.license.sha256, 'LICENSE hash differs from the fixed upstream baseline');

execFileSync('git', ['merge-base', '--is-ancestor', EXPECTED.upstreamCommit, 'HEAD'], {stdio: 'inherit'});
console.log(`Upstream baseline verified: ${EXPECTED.upstreamCommit} (${EXPECTED.upstreamVersion})`);
console.log(`LICENSE sha256: ${licenseHash}`);
console.log(`Remote topology status: ${baseline.remoteTopology.verificationStatus}`);
