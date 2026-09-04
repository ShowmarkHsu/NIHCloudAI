import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

import {verifyCanonicalMigration} from '../../../scripts/verify-upstream-baseline.mjs';

function git(cwd: string, args: string[], encoding: 'buffer'): Buffer;
function git(cwd: string, args: string[], encoding?: BufferEncoding): string;
function git(cwd: string, args: string[], encoding: BufferEncoding | 'buffer' = 'utf8') {
  return execFileSync('git', args, {cwd, encoding, maxBuffer: 8 * 1024 * 1024});
}

function initRepository(path: string) {
  git(path, ['init', '--quiet']);
  git(path, ['config', 'user.name', 'Provenance Test']);
  git(path, ['config', 'user.email', 'provenance@example.invalid']);
  git(path, ['config', 'core.autocrlf', 'false']);
}

function commitFile(path: string, contents: string, message: string) {
  writeFileSync(join(path, 'fixture.txt'), contents, 'utf8');
  git(path, ['add', 'fixture.txt']);
  git(path, ['commit', '--quiet', '-m', message]);
  return git(path, ['rev-parse', 'HEAD']).trim();
}

function createMigrationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'nihcloudai-provenance-'));
  const upstream = join(root, 'upstream');
  const canonical = join(root, 'canonical');
  const calculator = join(root, 'calculator');
  execFileSync('git', ['init', '--quiet', upstream]);
  execFileSync('git', ['init', '--quiet', canonical]);
  execFileSync('git', ['init', '--quiet', calculator]);
  initRepository(upstream);
  initRepository(canonical);

  const upstreamSnapshotCommit = commitFile(upstream, 'upstream snapshot\n', 'upstream snapshot');
  const upstreamSnapshotTree = git(upstream, ['rev-parse', `${upstreamSnapshotCommit}^{tree}`]).trim();
  const canonicalBaseCommit = commitFile(canonical, 'canonical baseline\n', 'canonical baseline');
  commitFile(canonical, 'preserved evidence\n', 'preserve evidence');
  const importCommit = commitFile(canonical, 'imported snapshot\n', 'import snapshot');
  const importTree = git(canonical, ['rev-parse', `${importCommit}^{tree}`]).trim();
  git(calculator, ['fetch', '--quiet', '--no-tags', canonical, canonicalBaseCommit]);
  git(calculator, ['fetch', '--quiet', '--no-tags', upstream, upstreamSnapshotCommit]);
  const patchBytes = git(
    calculator,
    [
      '-c', 'core.quotePath=true',
      '-c', 'diff.renames=true',
      '-c', 'diff.algorithm=myers',
      'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv',
      canonicalBaseCommit, upstreamSnapshotCommit,
    ],
    'buffer',
  );
  const patchSha256 = createHash('sha256').update(patchBytes).digest('hex');

  return {
    root,
    upstream,
    canonical,
    migration: {
      method: 'two-tree-patch',
      canonicalBaseCommit,
      upstreamSnapshotCommit,
      upstreamSnapshotTree,
      importCommit,
      importTree,
      patchSha256,
    },
  };
}

describe('fixed upstream remote topology contract', () => {
  it('keeps historical upstream provenance separate from current product identity', () => {
    const baseline = JSON.parse(readFileSync(
      resolve(process.cwd(), 'docs', 'upstream-sync', 'baseline.json'),
      'utf8',
    )) as {
      schemaVersion: number;
      product: {name: string; integrationRepositoryAtCapture: string};
      upstream: {version: string};
      canonicalMigration: Record<string, string>;
    };
    const packageJson = JSON.parse(readFileSync(
      resolve(process.cwd(), 'package.json'),
      'utf8',
    )) as {name: string; version: string; repository: {url: string}};

    expect(baseline.schemaVersion).toBe(3);
    expect(baseline.product).toEqual({
      name: 'NIHCloudAI',
      integrationRepositoryAtCapture:
        'https://github.com/ShowmarkHsu/NHITW_cloud_analyzer_react_MUI.git',
    });
    expect(baseline.upstream.version).toBe('26.0702.1');
    expect(baseline.canonicalMigration).toEqual({
      method: 'two-tree-patch',
      canonicalBaseCommit: 'f48a7411786ecd7b6586ff26e33a446827d378b0',
      upstreamSnapshotCommit: 'cad76e59c60eafc2947939fc44d7683ba9f7ab9d',
      upstreamSnapshotTree: '935820baf34e8e8f2ae01e26b29eac3af786f559',
      importCommit: 'f7debf69835bd8261cb767c9c27a741b255456c9',
      importTree: 'eb743c59a961a7782c4aaed028c316a120f9d9a0',
      patchSha256: 'aa9d8bc02ff40ee43c33c36237fe9dcbe910134b513d21341c23efcbb8ea44ca',
    });
    expect(packageJson).toMatchObject({
      name: 'nihcloudai',
      version: '0.2.0',
      repository: {url: 'https://github.com/ShowmarkHsu/NIHCloudAI.git'},
    });
  });

  it('pins every recorded remote role instead of checking only its value types', () => {
    const baseline = JSON.parse(readFileSync(
      resolve(process.cwd(), 'docs', 'upstream-sync', 'baseline.json'),
      'utf8',
    )) as {remoteTopology: {roles: Record<string, unknown>}};

    expect(baseline.remoteTopology.roles).toMatchObject({
      origin: {
        repository: 'https://github.com/ShowmarkHsu/NHITW_cloud_analyzer_react_MUI.git',
        configured: true,
        readable: true,
        writable: true,
      },
      upstream: {
        repository: 'https://github.com/leescot/NHITW_cloud_analyzer_react_MUI.git',
        configured: true,
        readable: true,
        writable: false,
      },
      nicloudai: {
        repository: 'https://github.com/ShowmarkHsu/NIHCloudAI.git',
        configured: true,
        readable: true,
        writable: true,
      },
    });
  });
});

describe('canonical two-tree patch provenance verifier', () => {
  it('fetches a pinned snapshot without adding a permanent remote and verifies both trees and patch bytes', () => {
    const fixture = createMigrationFixture();
    try {
      verifyCanonicalMigration({
        migration: fixture.migration,
        upstreamRepository: fixture.upstream,
        cwd: fixture.canonical,
      });

      expect(git(fixture.canonical, ['remote']).trim()).toBe('');
      expect(git(fixture.canonical, ['for-each-ref', '--format=%(refname)', 'refs/nihcloudai-verification']).trim())
        .toBe('');
    } finally {
      rmSync(fixture.root, {recursive: true, force: true});
    }
  }, 15_000);

  it('fails closed when the pinned upstream snapshot cannot be fetched', () => {
    const fixture = createMigrationFixture();
    try {
      expect(() => verifyCanonicalMigration({
        migration: {...fixture.migration, upstreamSnapshotCommit: '0'.repeat(40)},
        upstreamRepository: fixture.upstream,
        cwd: fixture.canonical,
      })).toThrow(/unable to fetch pinned upstream snapshot/);
    } finally {
      rmSync(fixture.root, {recursive: true, force: true});
    }
  }, 15_000);

  it('rejects a tampered upstream snapshot tree', () => {
    const fixture = createMigrationFixture();
    try {
      expect(() => verifyCanonicalMigration({
        migration: {...fixture.migration, upstreamSnapshotTree: '1'.repeat(40)},
        upstreamRepository: fixture.upstream,
        cwd: fixture.canonical,
      })).toThrow('upstream snapshot tree drifted');
    } finally {
      rmSync(fixture.root, {recursive: true, force: true});
    }
  }, 15_000);

  it('rejects a tampered two-tree patch SHA-256', () => {
    const fixture = createMigrationFixture();
    try {
      expect(() => verifyCanonicalMigration({
        migration: {...fixture.migration, patchSha256: '0'.repeat(64)},
        upstreamRepository: fixture.upstream,
        cwd: fixture.canonical,
      })).toThrow('canonical migration patch SHA-256 drifted');
    } finally {
      rmSync(fixture.root, {recursive: true, force: true});
    }
  }, 15_000);
});
