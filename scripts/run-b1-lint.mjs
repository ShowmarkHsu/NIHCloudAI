import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {resolve, sep} from 'node:path';
import {spawnSync} from 'node:child_process';

const root = resolve(import.meta.dirname, '..');

export const directLintFiles = [
  'eslint.config.js',
  'playwright.config.mjs',
  'vite.visual.config.js',
  'scripts/run-b1-lint.mjs',
  'scripts/verify-upstream-baseline.mjs',
  'tests/lint/b1-lint-scope.test.mjs',
  'tests/run-browser-mocha.mjs',
];

export const lintRoots = [
  'tests/characterization',
  'tests/visual',
];

export const aiTypecheckRoots = [
  'src/ai/contracts',
  'src/ai/release',
  'src/ai/session',
  'src/background',
  'tests/ai/contracts',
  'tests/ai/session',
  'tests/ai/security',
];

const lintExtensions = new Set(['.js', '.jsx', '.mjs']);

function normalize(relativePath) {
  return relativePath.split(sep).join('/');
}

function extension(relativePath) {
  return relativePath.slice(relativePath.lastIndexOf('.'));
}

function isInside(relativePath, directory) {
  return relativePath === directory || relativePath.startsWith(`${directory}/`);
}

export function classifyMaintainedFile(relativePath) {
  const normalized = normalize(relativePath);
  if (directLintFiles.includes(normalized)) return 'eslint';
  if (lintRoots.some((directory) => isInside(normalized, directory)) && lintExtensions.has(extension(normalized))) {
    return 'eslint';
  }
  if (aiTypecheckRoots.some((directory) => isInside(normalized, directory)) && extension(normalized) === '.ts') {
    return 'typecheck';
  }
  return undefined;
}

function walk(directory) {
  const absoluteDirectory = resolve(root, directory);
  if (!existsSync(absoluteDirectory)) throw new Error(`Missing maintained directory: ${directory}`);
  return readdirSync(absoluteDirectory, {withFileTypes: true}).flatMap((entry) => {
    const relativePath = normalize(`${directory}/${entry.name}`);
    if (entry.isDirectory()) return walk(relativePath);
    return entry.isFile() ? [relativePath] : [];
  });
}

function assertTypecheckScope() {
  const config = JSON.parse(readFileSync(resolve(root, 'tsconfig.ai.json'), 'utf8'));
  const included = new Set(config.include);
  for (const directory of aiTypecheckRoots) {
    const expectedGlob = `${directory}/**/*.ts`;
    if (!included.has(expectedGlob)) {
      throw new Error(`AI typecheck scope must include ${expectedGlob}`);
    }
  }
}

export function collectLintTargets() {
  assertTypecheckScope();
  const targets = new Set(directLintFiles);
  for (const directory of lintRoots) {
    for (const relativePath of walk(directory)) {
      if (lintExtensions.has(extension(relativePath))) targets.add(relativePath);
    }
  }
  for (const target of targets) {
    if (!existsSync(resolve(root, target)) || !statSync(resolve(root, target)).isFile()) {
      throw new Error(`Missing maintained lint target: ${target}`);
    }
    if (classifyMaintainedFile(target) !== 'eslint') {
      throw new Error(`Maintained lint target escaped the declared scope: ${target}`);
    }
  }
  return [...targets].sort();
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] === import.meta.filename) {
  const targets = collectLintTargets();
  run(process.execPath, [resolve(root, 'node_modules/eslint/bin/eslint.js'), ...targets]);
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.ai.json']);
}
