import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const EXPECTED = Object.freeze({
  upstreamRepository: 'https://github.com/leescot/NHITW_cloud_analyzer_react_MUI.git',
  upstreamCommit: 'cad76e59c60eafc2947939fc44d7683ba9f7ab9d',
  upstreamVersion: '26.0702.1',
  sourceRepository: 'https://github.com/ShowmarkHsu/NIHCloudAI.git',
  sourceCommit: 'bab69c741e1f6a5b2da65276ce8fe955973e05ca',
  integrationRepositoryAtCapture: 'https://github.com/ShowmarkHsu/NHITW_cloud_analyzer_react_MUI.git',
  canonicalMigration: {
    method: 'two-tree-patch',
    canonicalBaseCommit: 'f48a7411786ecd7b6586ff26e33a446827d378b0',
    upstreamSnapshotCommit: 'cad76e59c60eafc2947939fc44d7683ba9f7ab9d',
    upstreamSnapshotTree: '935820baf34e8e8f2ae01e26b29eac3af786f559',
    importCommit: 'f7debf69835bd8261cb767c9c27a741b255456c9',
    importTree: 'eb743c59a961a7782c4aaed028c316a120f9d9a0',
    patchSha256: 'aa9d8bc02ff40ee43c33c36237fe9dcbe910134b513d21341c23efcbb8ea44ca',
  },
  remoteTopologyStatus: 'verified-final-fork-accessible',
  remoteRoles: {
    origin: {
      repository: 'https://github.com/ShowmarkHsu/NHITW_cloud_analyzer_react_MUI.git',
      configured: true, readable: true, writable: true,
    },
    upstream: {
      repository: 'https://github.com/leescot/NHITW_cloud_analyzer_react_MUI.git',
      configured: true, readable: true, writable: false,
    },
    nicloudai: {
      repository: 'https://github.com/ShowmarkHsu/NIHCloudAI.git',
      configured: true, readable: true, writable: true,
    },
  },
});

const baseline = JSON.parse(await readFile(new URL('../docs/upstream-sync/baseline.json', import.meta.url)));
const baselineSchema = JSON.parse(await readFile(new URL('../docs/upstream-sync/baseline.schema.json', import.meta.url)));
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

function isAncestor(commit, cwd = process.cwd()) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {cwd, stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

function gitOutput(args, cwd = process.cwd()) {
  return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
}

function hasCommit(commit, cwd) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {cwd, stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

function fetchPinnedCommit(repository, commit, cwd) {
  const temporaryRef = `refs/nihcloudai-verification/upstream-${process.pid}-${Date.now()}`;
  try {
    execFileSync(
      'git',
      ['fetch', '--no-tags', '--force', repository, `${commit}:${temporaryRef}`],
      {cwd, stdio: 'pipe'},
    );
    assert(gitOutput(['rev-parse', temporaryRef], cwd) === commit, 'fetched upstream snapshot ref drifted');
  } catch (error) {
    try {
      execFileSync('git', ['update-ref', '-d', temporaryRef], {cwd, stdio: 'ignore'});
    } catch {
      // The fetch may have failed before creating the temporary ref.
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`unable to fetch pinned upstream snapshot ${commit}: ${detail}`);
  }

  return () => {
    execFileSync('git', ['update-ref', '-d', temporaryRef], {cwd, stdio: 'ignore'});
  };
}

function migrationPatchBytes(canonicalBaseCommit, upstreamSnapshotCommit, cwd) {
  return execFileSync(
    'git',
    [
      '-c', 'core.quotePath=true',
      '-c', 'diff.renames=true',
      '-c', 'diff.algorithm=myers',
      'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv',
      canonicalBaseCommit, upstreamSnapshotCommit,
    ],
    {cwd, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024},
  );
}

export function verifyCanonicalMigration({migration, upstreamRepository, cwd = process.cwd()}) {
  assert(isAncestor(migration.canonicalBaseCommit, cwd), 'canonical migration base is not an ancestor of HEAD');
  assert(isAncestor(migration.importCommit, cwd), 'canonical snapshot import commit is not an ancestor of HEAD');

  const cleanup = hasCommit(migration.upstreamSnapshotCommit, cwd)
    ? () => {}
    : fetchPinnedCommit(upstreamRepository, migration.upstreamSnapshotCommit, cwd);

  try {
    assert(
      gitOutput(['rev-parse', `${migration.upstreamSnapshotCommit}^{tree}`], cwd)
        === migration.upstreamSnapshotTree,
      'upstream snapshot tree drifted',
    );
    assert(
      gitOutput(['rev-parse', `${migration.importCommit}^{tree}`], cwd) === migration.importTree,
      'canonical snapshot import tree drifted',
    );

    const patchHash = createHash('sha256')
      .update(migrationPatchBytes(
        migration.canonicalBaseCommit,
        migration.upstreamSnapshotCommit,
        cwd,
      ))
      .digest('hex');
    assert(patchHash === migration.patchSha256, 'canonical migration patch SHA-256 drifted');
  } finally {
    cleanup();
  }
}

async function main() {
assertExactKeys(baseline, ['$schema', 'schemaVersion', 'capturedAt', 'product', 'upstream', 'nicloudaiSource', 'canonicalMigration', 'remoteTopology'], 'baseline');
assertExactKeys(baseline.product, ['name', 'integrationRepositoryAtCapture'], 'product');
assertExactKeys(baseline.upstream, ['repository', 'commit', 'version', 'license'], 'upstream');
assertExactKeys(baseline.upstream.license, ['spdx', 'path', 'sha256'], 'upstream.license');
assertExactKeys(baseline.nicloudaiSource, ['repository', 'commit'], 'nicloudaiSource');
assertExactKeys(
  baseline.canonicalMigration,
  ['method', 'canonicalBaseCommit', 'upstreamSnapshotCommit', 'upstreamSnapshotTree', 'importCommit', 'importTree', 'patchSha256'],
  'canonicalMigration',
);
assertExactKeys(baseline.remoteTopology, ['verificationStatus', 'checkedAt', 'roles'], 'remoteTopology');
assertExactKeys(baseline.remoteTopology.roles, ['origin', 'upstream', 'nicloudai'], 'remoteTopology.roles');
for (const [name, role] of Object.entries(baseline.remoteTopology.roles)) {
  assertExactKeys(role, ['repository', 'configured', 'readable', 'writable', 'note'], `remoteTopology.roles.${name}`);
  assert(typeof role.configured === 'boolean', `${name}.configured must be boolean`);
  assert(typeof role.readable === 'boolean', `${name}.readable must be boolean`);
  assert(typeof role.writable === 'boolean', `${name}.writable must be boolean`);
  assert(typeof role.note === 'string' && role.note.length > 0, `${name}.note is required`);
  const expectedRole = EXPECTED.remoteRoles[name];
  assert(expectedRole !== undefined, `unexpected remote role: ${name}`);
  assert(role.repository === expectedRole.repository, `${name}.repository drifted`);
  assert(role.configured === expectedRole.configured, `${name}.configured drifted`);
  assert(role.readable === expectedRole.readable, `${name}.readable drifted`);
  assert(role.writable === expectedRole.writable, `${name}.writable drifted`);
}

assert(baseline.$schema === './baseline.schema.json', 'unexpected schema reference');
assert(baseline.schemaVersion === 3, 'unexpected schema version');
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
assert(
  baseline.product.integrationRepositoryAtCapture === EXPECTED.integrationRepositoryAtCapture,
  'captured integration repository drifted',
);
assert(baseline.upstream.repository === EXPECTED.upstreamRepository, 'upstream repository drifted');
assert(baseline.upstream.commit === EXPECTED.upstreamCommit, 'upstream commit drifted');
assert(baseline.upstream.version === EXPECTED.upstreamVersion, 'upstream version drifted');
assert(baseline.upstream.license.spdx === 'Apache-2.0', 'license must remain Apache-2.0');
assert(baseline.nicloudaiSource.repository === EXPECTED.sourceRepository, 'NIHCloudAI source repository drifted');
assert(baseline.nicloudaiSource.commit === EXPECTED.sourceCommit, 'NIHCloudAI source commit drifted');
assert(
  JSON.stringify(baseline.canonicalMigration) === JSON.stringify(EXPECTED.canonicalMigration),
  'canonical migration evidence drifted',
);
const licenseHash = createHash('sha256').update(licenseBytes).digest('hex');
assert(licenseHash === baseline.upstream.license.sha256, 'LICENSE hash differs from the fixed upstream baseline');

let provenanceMode = 'upstream-ancestor';
if (!isAncestor(EXPECTED.upstreamCommit)) {
  provenanceMode = 'canonical-two-tree-patch';
  verifyCanonicalMigration({
    migration: EXPECTED.canonicalMigration,
    upstreamRepository: EXPECTED.upstreamRepository,
  });
}
console.log(`Upstream baseline verified: ${EXPECTED.upstreamCommit} (${EXPECTED.upstreamVersion})`);
console.log(`Provenance mode: ${provenanceMode}`);
console.log(`LICENSE sha256: ${licenseHash}`);
console.log(`Remote topology status: ${baseline.remoteTopology.verificationStatus}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
