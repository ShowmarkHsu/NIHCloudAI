import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

import {afterEach, describe, expect, it} from 'vitest';

// @ts-expect-error -- Node release scripts are intentionally plain ESM.
import {createDeterministicZip, createReleasePackage, createReleaseFromRepository} from '../../../scripts/create-release-artifact.mjs';
import {releaseManifestV1Schema} from '../../../src/ai/release/runtimeManifest';

const temporaryDirectories: string[] = [];
const fixedEvidence = {
  ollama: {
    configurationSha256: `sha256:${'a'.repeat(64)}`,
    clinicalAcceptanceSha256: `sha256:${'b'.repeat(64)}`,
  },
  openRouter: {
    configurationSha256: `sha256:${'c'.repeat(64)}`,
    clinicalAcceptanceSha256: `sha256:${'d'.repeat(64)}`,
  },
  openRouterMetadataSha256: `sha256:${'e'.repeat(64)}`,
} as const;

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'nihcloudai-release-'));
  temporaryDirectories.push(directory);
  return directory;
}

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
}

async function initializeGitRepository(root: string) {
  git(root, 'init');
  git(root, 'config', 'user.name', 'Release Test');
  git(root, 'config', 'user.email', 'release-test@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  await writeFile(join(root, 'tracked.txt'), 'fixed\n');
  git(root, 'add', '--', '.');
  git(root, 'commit', '-m', 'test fixture');
}

async function createBuildableRepository(root: string, extraPermissions: string[] = []) {
  const repository = join(root, 'repository');
  const extensionManifest = {
    manifest_version: 3,
    version: '26.0702.1',
    permissions: ['storage', 'clipboardWrite', ...extraPermissions],
    host_permissions: ['https://medcloud2.nhi.gov.tw/*', 'https://drugtw.com/*'],
    optional_host_permissions: ['http://127.0.0.1:11434/*', 'https://openrouter.ai/*'],
  };
  await mkdir(join(repository, 'release'), {recursive: true});
  await mkdir(join(repository, 'docs', 'upstream-sync'), {recursive: true});
  await writeFile(join(repository, '.gitignore'), 'dist/\n');
  await writeFile(join(repository, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    scripts: {build: 'node build.mjs'},
  }));
  await writeFile(join(repository, 'build.mjs'), [
    "import {mkdir, rm, writeFile} from 'node:fs/promises';",
    "await rm('dist', {recursive: true, force: true});",
    "await mkdir('dist', {recursive: true});",
    `await writeFile('dist/manifest.json', JSON.stringify(${JSON.stringify(extensionManifest)}));`,
    "await writeFile('dist/content.js', '(()=>{})();\\n');",
    '',
  ].join('\n'));
  await writeFile(
    join(repository, 'release', 'manifest.schema.json'),
    await readFile(resolve(process.cwd(), 'release', 'manifest.schema.json')),
  );
  await writeFile(
    join(repository, 'docs', 'upstream-sync', 'baseline.json'),
    JSON.stringify({upstream: {commit: '2'.repeat(40)}}),
  );
  await initializeGitRepository(repository);
  return repository;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, {recursive: true, force: true})));
});

describe('immutable NIHCloudAI release artifact', () => {
  it('fails closed when the release owner inputs are missing', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts', 'create-release-artifact.mjs')],
      {cwd: process.cwd(), encoding: 'utf8'},
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required option: --version');
  });

  it('creates byte-identical ZIPs from identical dist contents regardless of file order or timestamps', async () => {
    const root = await temporaryDirectory();
    const firstDist = join(root, 'first-dist');
    const secondDist = join(root, 'second-dist');
    await mkdir(join(firstDist, 'assets'), {recursive: true});
    await mkdir(join(secondDist, 'assets'), {recursive: true});

    await writeFile(join(firstDist, 'manifest.json'), '{"version":"1"}\n');
    await writeFile(join(firstDist, 'assets', 'app.js'), 'console.log("fixed");\n');
    await writeFile(join(secondDist, 'assets', 'app.js'), 'console.log("fixed");\n');
    await writeFile(join(secondDist, 'manifest.json'), '{"version":"1"}\n');
    await utimes(join(firstDist, 'manifest.json'), new Date('2026-01-01'), new Date('2026-01-01'));
    await utimes(join(secondDist, 'manifest.json'), new Date('2026-08-31'), new Date('2026-08-31'));

    const firstZip = join(root, 'first.zip');
    const secondZip = join(root, 'second.zip');
    await createDeterministicZip({sourceDirectory: firstDist, outputFile: firstZip});
    await createDeterministicZip({sourceDirectory: secondDist, outputFile: secondZip});

    const firstBytes = await readFile(firstZip);
    const secondBytes = await readFile(secondZip);
    expect(secondBytes).toEqual(firstBytes);
    expect(firstBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(createHash('sha256').update(firstBytes).digest('hex')).toHaveLength(64);
  });

  it('refuses to create provenance from a dirty repository', async () => {
    const root = await temporaryDirectory();
    await initializeGitRepository(root);
    await writeFile(join(root, 'untracked.txt'), 'must fail closed\n');

    await expect(createReleaseFromRepository({
      repositoryRoot: root,
      outputDirectory: join(root, 'release-output'),
      releaseVersion: '1.0.0',
      evidence: fixedEvidence,
    })).rejects.toThrow('release repository must be clean');
  });

  it('builds twice and emits provenance only when the clean HEAD is reproducible', async () => {
    const root = await temporaryDirectory();
    const repository = await createBuildableRepository(root);
    const output = join(root, 'release-output');
    const sourceCommit = git(repository, 'rev-parse', 'HEAD');

    await createReleaseFromRepository({
      repositoryRoot: repository,
      outputDirectory: output,
      releaseVersion: '1.0.0',
      evidence: fixedEvidence,
    });

    const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
    expect(manifest.source).toEqual({
      upstreamCommit: '2'.repeat(40),
      nihCloudAiCommit: sourceCommit,
      extensionVersion: '26.0702.1',
    });
    expect(releaseManifestV1Schema.safeParse(manifest).success).toBe(true);
    expect(await readFile(join(output, 'nihcloudai-extension.zip'))).not.toHaveLength(0);
  }, 15_000);

  it('refuses a reproducible dist that violates the fixed release-readiness policy', async () => {
    const root = await temporaryDirectory();
    const repository = await createBuildableRepository(root, ['scripting']);
    const output = join(root, 'release-output');

    await expect(createReleaseFromRepository({
      repositoryRoot: repository,
      outputDirectory: output,
      releaseVersion: '1.0.0',
      evidence: fixedEvidence,
    })).rejects.toThrow('manifest permissions must be exactly: clipboardWrite, storage');
    await expect(readFile(join(output, 'nihcloudai-extension.zip'))).rejects.toThrow();
  });

  it('binds the ZIP, source commits, extension build, and external evidence hashes in a closed manifest and SHA256SUMS', async () => {
    const root = await temporaryDirectory();
    const dist = join(root, 'dist');
    const output = join(root, 'release-output');
    await mkdir(dist, {recursive: true});
    await writeFile(join(dist, 'manifest.json'), JSON.stringify({version: '26.0702.1'}));
    await writeFile(join(dist, 'content.js'), '(()=>{})();\n');

    await createReleasePackage({
      sourceDirectory: dist,
      outputDirectory: output,
      releaseVersion: '1.0.0',
      sourceCommit: '1'.repeat(40),
      upstreamCommit: '2'.repeat(40),
      evidence: fixedEvidence,
    });

    const zipBytes = await readFile(join(output, 'nihcloudai-extension.zip'));
    const manifestBytes = await readFile(join(output, 'release-manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const zipSha256 = createHash('sha256').update(zipBytes).digest('hex');
    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');

    expect(releaseManifestV1Schema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({
      artifact: {
        artifact: 'nihcloudai-extension.zip',
        version: '1.0.0',
        sha256: `sha256:${zipSha256}`,
      },
      source: {
        upstreamCommit: '2'.repeat(40),
        nihCloudAiCommit: '1'.repeat(40),
        extensionVersion: '26.0702.1',
      },
      evidence: fixedEvidence,
    });
    await expect(readFile(join(output, 'SHA256SUMS'), 'utf8')).resolves.toBe(
      `${zipSha256}  nihcloudai-extension.zip\n${manifestSha256}  release-manifest.json\n`,
    );
  });
});
