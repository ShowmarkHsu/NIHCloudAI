import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {deflateRawSync} from 'node:zlib';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

import {assessReleaseReadiness} from './verify-release-readiness.mjs';

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DEFLATE_METHOD = 8;
const ZIP_FIXED_DOS_TIME = 0;
const ZIP_FIXED_DOS_DATE = 0x0021;
const ZIP32_MAXIMUM = 0xffffffff;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultReleaseSchema = path.resolve(moduleDirectory, '..', 'release', 'manifest.schema.json');
const requiredReleaseOptions = [
  'version',
  'ollama-configuration-sha256',
  'ollama-clinical-acceptance-sha256',
  'openrouter-configuration-sha256',
  'openrouter-clinical-acceptance-sha256',
  'openrouter-metadata-sha256',
];

const crc32Table = Array.from({length: 256}, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function filesUnder(directory, relativeDirectory = '') {
  const entries = await readdir(path.join(directory, relativeDirectory), {withFileTypes: true});
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll(path.sep, '/'), entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`release artifact source must not contain symlinks: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await filesUnder(directory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`release artifact source contains an unsupported entry: ${relativePath}`);
    }
  }
  return files;
}

function assertZip32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > ZIP32_MAXIMUM) {
    throw new Error(`${label} exceeds the supported ZIP32 boundary`);
  }
}

function localHeader({name, checksum, compressedSize, uncompressedSize}) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  header.writeUInt16LE(ZIP_DEFLATE_METHOD, 8);
  header.writeUInt16LE(ZIP_FIXED_DOS_TIME, 10);
  header.writeUInt16LE(ZIP_FIXED_DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader({name, checksum, compressedSize, uncompressedSize, offset}) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  header.writeUInt16LE(ZIP_DEFLATE_METHOD, 10);
  header.writeUInt16LE(ZIP_FIXED_DOS_TIME, 12);
  header.writeUInt16LE(ZIP_FIXED_DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endOfCentralDirectory({entryCount, centralDirectorySize, centralDirectoryOffset}) {
  if (entryCount > 0xffff) {
    throw new Error('release artifact contains too many files for ZIP32');
  }
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(centralDirectorySize, 12);
  footer.writeUInt32LE(centralDirectoryOffset, 16);
  footer.writeUInt16LE(0, 20);
  return footer;
}

export async function createDeterministicZip({sourceDirectory, outputFile}) {
  const fileNames = await filesUnder(sourceDirectory);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const fileName of fileNames) {
    const name = Buffer.from(fileName, 'utf8');
    if (name.length > 0xffff) throw new Error(`release artifact path is too long: ${fileName}`);
    const contents = await readFile(path.join(sourceDirectory, ...fileName.split('/')));
    const compressed = deflateRawSync(contents, {level: 9});
    assertZip32(contents.length, `${fileName} uncompressed size`);
    assertZip32(compressed.length, `${fileName} compressed size`);
    assertZip32(offset, `${fileName} local header offset`);
    const checksum = crc32(contents);
    const local = localHeader({
      name,
      checksum,
      compressedSize: compressed.length,
      uncompressedSize: contents.length,
    });
    localParts.push(local, name, compressed);
    centralParts.push(
      centralHeader({
        name,
        checksum,
        compressedSize: compressed.length,
        uncompressedSize: contents.length,
        offset,
      }),
      name,
    );
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  assertZip32(offset, 'central directory offset');
  assertZip32(centralDirectory.length, 'central directory size');
  const archive = Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory({
      entryCount: fileNames.length,
      centralDirectorySize: centralDirectory.length,
      centralDirectoryOffset: offset,
    }),
  ]);
  await mkdir(path.dirname(outputFile), {recursive: true});
  await writeFile(outputFile, archive, {flag: 'wx'});
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertMatches(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function constantsFrom(properties, label) {
  return Object.fromEntries(Object.entries(properties).map(([key, definition]) => {
    if (!Object.hasOwn(definition, 'const')) {
      throw new Error(`release schema ${label}.${key} must be fixed with const`);
    }
    return [key, definition.const];
  }));
}

function validateEvidence(evidence) {
  const hashes = [
    ['Ollama configuration SHA-256', evidence?.ollama?.configurationSha256],
    ['Ollama clinical acceptance SHA-256', evidence?.ollama?.clinicalAcceptanceSha256],
    ['OpenRouter configuration SHA-256', evidence?.openRouter?.configurationSha256],
    ['OpenRouter clinical acceptance SHA-256', evidence?.openRouter?.clinicalAcceptanceSha256],
    ['OpenRouter metadata SHA-256', evidence?.openRouterMetadataSha256],
  ];
  for (const [label, value] of hashes) assertMatches(value, SHA256_PATTERN, label);
}

function runProductionBuild(repositoryRoot) {
  const options = {cwd: repositoryRoot, stdio: 'pipe'};
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build'], options);
  } else {
    execFileSync('npm', ['run', 'build'], options);
  }
}

async function assertReleaseReady(sourceDirectory) {
  const manifest = JSON.parse(await readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8'));
  const artifacts = await Promise.all((await filesUnder(sourceDirectory)).map(async (fileName) => ({
    path: `dist/${fileName}`,
    contents: await readFile(path.join(sourceDirectory, ...fileName.split('/')), 'utf8'),
  })));
  const failures = assessReleaseReadiness({manifest, artifacts});
  if (failures.length > 0) {
    throw new Error(`Release readiness failed:\n- ${failures.join('\n- ')}`);
  }
}

export async function createReleasePackage({
  sourceDirectory,
  outputDirectory,
  releaseVersion,
  sourceCommit,
  upstreamCommit,
  evidence,
  releaseSchemaPath = defaultReleaseSchema,
}) {
  assertMatches(releaseVersion, SEMVER_PATTERN, 'release version');
  assertMatches(sourceCommit, GIT_COMMIT_PATTERN, 'source commit');
  assertMatches(upstreamCommit, GIT_COMMIT_PATTERN, 'upstream commit');
  validateEvidence(evidence);

  const releaseSchema = JSON.parse(await readFile(releaseSchemaPath, 'utf8'));
  const extensionManifest = JSON.parse(
    await readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8'),
  );
  assertMatches(extensionManifest.version, SEMVER_PATTERN, 'extension build version');
  await mkdir(path.dirname(outputDirectory), {recursive: true});
  await mkdir(outputDirectory);

  const artifactName = releaseSchema.properties.artifact.properties.artifact.const;
  const zipFile = path.join(outputDirectory, artifactName);
  await createDeterministicZip({sourceDirectory, outputFile: zipFile});
  const zipBytes = await readFile(zipFile);
  const zipSha256 = sha256(zipBytes);

  const manifest = {
    schemaVersion: releaseSchema.properties.schemaVersion.const,
    artifact: {
      artifact: artifactName,
      version: releaseVersion,
      sha256: `sha256:${zipSha256}`,
    },
    source: {
      upstreamCommit,
      nihCloudAiCommit: sourceCommit,
      extensionVersion: extensionManifest.version,
    },
    contracts: constantsFrom(releaseSchema.properties.contracts.properties, 'contracts'),
    providers: {
      ollama: constantsFrom(
        releaseSchema.properties.providers.properties.ollama.properties,
        'providers.ollama',
      ),
      openRouter: constantsFrom(
        releaseSchema.properties.providers.properties.openRouter.properties,
        'providers.openRouter',
      ),
    },
    evidence,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestName = 'release-manifest.json';
  await writeFile(path.join(outputDirectory, manifestName), manifestBytes, {flag: 'wx'});
  const manifestSha256 = sha256(manifestBytes);
  await writeFile(
    path.join(outputDirectory, 'SHA256SUMS'),
    `${zipSha256}  ${artifactName}\n${manifestSha256}  ${manifestName}\n`,
    {flag: 'wx'},
  );

  return {manifest, zipSha256, manifestSha256};
}

export function parseReleaseOwnerInputs(args) {
  const {values} = parseArgs({
    args,
    options: Object.fromEntries([
      ...requiredReleaseOptions.map((option) => [option, {type: 'string'}]),
      ['output-directory', {type: 'string'}],
    ]),
    allowPositionals: false,
  });
  for (const option of requiredReleaseOptions) {
    if (values[option] === undefined || values[option] === '') {
      throw new Error(`missing required option: --${option}`);
    }
  }
  return values;
}

export async function createReleaseFromRepository({
  repositoryRoot,
  outputDirectory,
  releaseVersion,
  evidence,
}) {
  const gitOutput = (...args) => execFileSync(
    'git',
    args,
    {cwd: repositoryRoot, encoding: 'utf8'},
  ).trim();
  const assertClean = () => {
    if (gitOutput('status', '--porcelain=v1', '--untracked-files=all') !== '') {
      throw new Error('release repository must be clean');
    }
  };
  assertClean();
  const sourceCommit = gitOutput('rev-parse', 'HEAD');
  assertMatches(sourceCommit, GIT_COMMIT_PATTERN, 'source commit');
  const baseline = JSON.parse(await readFile(
    path.join(repositoryRoot, 'docs', 'upstream-sync', 'baseline.json'),
    'utf8',
  ));
  const upstreamCommit = baseline?.upstream?.commit;
  assertMatches(upstreamCommit, GIT_COMMIT_PATTERN, 'upstream commit');

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nihcloudai-reproducible-build-'));
  const firstZip = path.join(temporaryRoot, 'first.zip');
  const secondZip = path.join(temporaryRoot, 'second.zip');
  try {
    runProductionBuild(repositoryRoot);
    assertClean();
    await assertReleaseReady(path.join(repositoryRoot, 'dist'));
    await createDeterministicZip({
      sourceDirectory: path.join(repositoryRoot, 'dist'),
      outputFile: firstZip,
    });
    runProductionBuild(repositoryRoot);
    assertClean();
    await assertReleaseReady(path.join(repositoryRoot, 'dist'));
    await createDeterministicZip({
      sourceDirectory: path.join(repositoryRoot, 'dist'),
      outputFile: secondZip,
    });
    const [firstBytes, secondBytes] = await Promise.all([readFile(firstZip), readFile(secondZip)]);
    if (!firstBytes.equals(secondBytes)) {
      throw new Error('consecutive production builds are not byte-identical');
    }
  } finally {
    await rm(temporaryRoot, {recursive: true, force: true});
  }

  return createReleasePackage({
    sourceDirectory: path.join(repositoryRoot, 'dist'),
    outputDirectory,
    releaseVersion,
    sourceCommit,
    upstreamCommit,
    evidence,
    releaseSchemaPath: path.join(repositoryRoot, 'release', 'manifest.schema.json'),
  });
}

async function main() {
  const inputs = parseReleaseOwnerInputs(process.argv.slice(2));
  const repositoryRoot = path.resolve(moduleDirectory, '..');
  const outputDirectory = inputs['output-directory'] === undefined
    ? path.join(repositoryRoot, 'zip', 'releases', inputs.version)
    : path.resolve(repositoryRoot, inputs['output-directory']);
  const result = await createReleaseFromRepository({
    repositoryRoot,
    outputDirectory,
    releaseVersion: inputs.version,
    evidence: {
      ollama: {
        configurationSha256: inputs['ollama-configuration-sha256'],
        clinicalAcceptanceSha256: inputs['ollama-clinical-acceptance-sha256'],
      },
      openRouter: {
        configurationSha256: inputs['openrouter-configuration-sha256'],
        clinicalAcceptanceSha256: inputs['openrouter-clinical-acceptance-sha256'],
      },
      openRouterMetadataSha256: inputs['openrouter-metadata-sha256'],
    },
  });
  process.stdout.write([
    `Immutable release created: ${outputDirectory}`,
    `Artifact SHA-256: sha256:${result.zipSha256}`,
    `Manifest SHA-256: sha256:${result.manifestSha256}`,
    '',
  ].join('\n'));
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`Release artifact creation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
