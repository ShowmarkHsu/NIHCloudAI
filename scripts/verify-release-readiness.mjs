import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_PERMISSIONS = ['clipboardWrite', 'storage'];
const ALLOWED_HOST_PERMISSIONS = [
  'https://drugtw.com/*',
  'https://medcloud2.nhi.gov.tw/*',
];
const SECRET_SHAPED_VALUE = /(?:sk-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{20,})/;

function sortedStrings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? [...value].sort()
    : [];
}

function sameStrings(actual, expected) {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

/**
 * Checks only machine-verifiable release boundaries. It intentionally does not
 * represent clinical sign-off or a real-provider validation result.
 */
export function assessReleaseReadiness({ manifest, artifacts }) {
  const failures = [];
  const permissions = sortedStrings(manifest?.permissions);
  const hostPermissions = sortedStrings(manifest?.host_permissions);

  if (!sameStrings(permissions, ALLOWED_PERMISSIONS)) {
    failures.push(`manifest permissions must be exactly: ${ALLOWED_PERMISSIONS.join(', ')}`);
  }
  if (!sameStrings(hostPermissions, ALLOWED_HOST_PERMISSIONS)) {
    failures.push(`manifest host permissions must be exactly: ${ALLOWED_HOST_PERMISSIONS.join(', ')}`);
  }

  for (const artifact of artifacts) {
    if (artifact.path.endsWith('.map')) {
      failures.push(`release artifact must not include source maps: ${artifact.path}`);
    }
    if (/sourceMappingURL=/i.test(artifact.contents)) {
      failures.push(`release artifact must not reference a source map: ${artifact.path}`);
    }
    if (SECRET_SHAPED_VALUE.test(artifact.contents)) {
      failures.push(`release artifact contains a secret-shaped value: ${artifact.path}`);
    }
  }

  return failures;
}

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const descendants = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  }));
  return descendants.flat();
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = path.join(root, 'dist');
  try {
    if (!(await stat(dist)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('missing dist; run npm run build before release verification');
  }

  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
  const artifacts = await Promise.all((await filesUnder(dist)).map(async (file) => ({
    path: path.relative(root, file).replaceAll(path.sep, '/'),
    contents: await readFile(file, 'utf8'),
  })));
  const failures = assessReleaseReadiness({ manifest, artifacts });
  if (failures.length > 0) {
    throw new Error(`Release readiness failed:\n- ${failures.join('\n- ')}`);
  }
  console.log(`Release readiness verified: ${artifacts.length} dist artifacts checked`);
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
