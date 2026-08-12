import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Directories and files which are not useful scan targets.  `dist` is
 * deliberately not included here: build output is part of the security
 * boundary and is scanned when it exists.
 */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "coverage",
]);

const SKIPPED_FILE_NAMES = new Set([
  "package-lock.json",
  "package-lock.yaml",
  "package-lock.yml",
]);

/**
 * Rule names are intentionally short and stable: they are suitable for CI
 * output and do not contain any matched text.
 */
export const RULES = Object.freeze({
  PROVIDER_KEY: "provider-key",
  SECRET_ASSIGNMENT: "hardcoded-secret-assignment",
  AUTHORIZATION_BEARER: "authorization-bearer-literal",
  PRIVATE_KEY_HEADER: "private-key-header",
  VITE_SECRET_VARIABLE: "vite-secret-variable",
});

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

// Common provider credentials.  These expressions only identify a credential
// shape; the matched value is never included in a finding or log message.
const PROVIDER_KEY_PATTERNS = Object.freeze([
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bhf_[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
]);

// Names which are expected to contain credentials when they receive a
// literal value.  The boundary after each alternative prevents names such as
// SECRET_PREFIX from being mistaken for a secret-bearing field.
const SENSITIVE_NAME =
  "(?:api[_-]?(?:key|token|secret)|access[_-]?(?:key|token)|" +
  "auth[_-]?token|bearer[_-]?token|client[_-]?(?:key|token|secret)|" +
  "refresh[_-]?token|secret[_-]?key|private[_-]?key|password|passwd|" +
  "token|secret)";

const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `\\b${SENSITIVE_NAME}(?![A-Za-z0-9_])\\s*(?:=|:)\\s*(?:["'\`])([A-Za-z0-9][A-Za-z0-9._~+/=-]{7,})(?:["'\`])`,
  "i",
);

// Unquoted assignments are common in `.env`/INI files.  Restrict this form to
// uppercase environment-style names so object properties such as
// `apiKey: message.apiKey` are not treated as embedded credentials.
const SENSITIVE_UNQUOTED_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(?:API[_-]?(?:KEY|TOKEN|SECRET)|ACCESS[_-]?(?:KEY|TOKEN)|AUTH[_-]?TOKEN|CLIENT[_-]?(?:KEY|TOKEN|SECRET)|REFRESH[_-]?TOKEN|SECRET[_-]?KEY|PASSWORD|PASSWD|TOKEN|SECRET)(?![A-Za-z0-9_])\\s*(?:=|:)\\s*([A-Za-z0-9][A-Za-z0-9_~+/=-]{7,})`,
);

// A literal bearer token must start with a concrete token character.  This
// intentionally does not match `${apiKey}`, environment references, or angle
// bracket placeholders.
const AUTHORIZATION_BEARER_PATTERN =
  /\bAuthorization\b\s*[:=]\s*["'`]?\s*Bearer\s+([A-Za-z0-9._~+/=-]{8,})/i;

const PRIVATE_KEY_HEADER_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/i;

const VITE_SECRET_VARIABLE_PATTERN =
  /\bVITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\b/;

const PLACEHOLDER_WORDS = new Set([
  "changeme",
  "dummy",
  "example",
  "fake",
  "invalid",
  "none",
  "null",
  "placeholder",
  "redacted",
  "sample",
  "test",
  "testing",
  "todo",
  "undefined",
  "unknown",
  "your-key",
  "your-token",
  "your-secret",
]);

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length < 8) return true;
  if (PLACEHOLDER_WORDS.has(normalized)) return true;
  if (/(?:^|[-_])(?:dummy|example|fake|placeholder|sample|test|testing)(?:$|[-_])/.test(normalized)) {
    return true;
  }
  if (/^(?:your|replace|insert|put)[-_ ]/.test(normalized)) return true;
  if (/^<[^>]+>$/.test(normalized)) return true;
  if (/^\$\{[^}]+\}$/.test(normalized)) return true;
  if (/^(?:process|import)\.env(?:\.|\[)/.test(normalized)) return true;
  return false;
}

function hasMeaningfulMatch(pattern, line) {
  const match = line.match(pattern);
  if (!match) return false;
  // Patterns with a capture group expose the candidate to placeholder
  // filtering.  Provider/private-key/VITE rules do not need this check.
  if (match[1] !== undefined && isPlaceholder(match[1])) return false;
  return true;
}

function finding(file, line, rule) {
  return Object.freeze({ file, line, rule });
}

/**
 * Scan one text value.  No matched value is retained in the returned object.
 *
 * @param {string} text
 * @param {string} [file="<input>"] label used in findings
 * @returns {Array<{file: string, line: number, rule: string}>}
 */
export function scanText(text, file = "<input>") {
  if (typeof text !== "string") {
    throw new TypeError("scanText expects a string");
  }

  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (PRIVATE_KEY_HEADER_PATTERN.test(line)) {
      findings.push(finding(file, lineNumber, RULES.PRIVATE_KEY_HEADER));
    }

    if (hasMeaningfulMatch(AUTHORIZATION_BEARER_PATTERN, line)) {
      findings.push(finding(file, lineNumber, RULES.AUTHORIZATION_BEARER));
    }

    if (VITE_SECRET_VARIABLE_PATTERN.test(line)) {
      findings.push(finding(file, lineNumber, RULES.VITE_SECRET_VARIABLE));
    }

    if (PROVIDER_KEY_PATTERNS.some((pattern) => pattern.test(line))) {
      findings.push(finding(file, lineNumber, RULES.PROVIDER_KEY));
    }

    const assignment =
      line.match(SENSITIVE_ASSIGNMENT_PATTERN) ??
      line.match(SENSITIVE_UNQUOTED_ASSIGNMENT_PATTERN);
    if (assignment && !isPlaceholder(assignment[1])) {
      findings.push(finding(file, lineNumber, RULES.SECRET_ASSIGNMENT));
    }
  });

  return deduplicateFindings(findings);
}

function deduplicateFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.file}\u0000${item.line}\u0000${item.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLikelyText(buffer) {
  // Null bytes are a reliable enough guard for common binary assets while
  // still allowing UTF-8 source, docs, JSON, and PEM files.
  return !buffer.includes(0);
}

/**
 * Scan one file synchronously.
 *
 * @param {string} filePath
 * @returns {Array<{file: string, line: number, rule: string}>}
 */
export function scanFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (!isLikelyText(buffer)) return [];
  return scanText(TEXT_DECODER.decode(buffer), filePath);
}

function shouldSkipDirectory(name) {
  return SKIPPED_DIRECTORIES.has(name);
}

function shouldSkipFile(name) {
  return SKIPPED_FILE_NAMES.has(name);
}

function collectFiles(directory, output) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) collectFiles(entryPath, output);
      continue;
    }
    if (entry.isFile() && !shouldSkipFile(entry.name)) output.push(entryPath);
  }
}

/**
 * Recursively scan a directory.  Build output is included when present;
 * ignored dependency/build directories are skipped explicitly above.
 *
 * @param {string} directory
 * @returns {Array<{file: string, line: number, rule: string}>}
 */
export function scanDirectory(directory) {
  const files = [];
  collectFiles(path.resolve(directory), files);
  return deduplicateFindings(files.flatMap((filePath) => scanFile(filePath)));
}

/**
 * Scan a mix of files and directories.
 *
 * @param {string|string[]} targets
 * @returns {Array<{file: string, line: number, rule: string}>}
 */
export function scanPaths(targets) {
  const values = Array.isArray(targets) ? targets : [targets];
  const findings = [];
  for (const target of values) {
    const resolved = path.resolve(target);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) findings.push(...scanDirectory(resolved));
    else if (stat.isFile() && !shouldSkipFile(path.basename(resolved))) {
      findings.push(...scanFile(resolved));
    }
  }
  return deduplicateFindings(findings);
}

/**
 * Format a finding without ever including the matched secret.
 */
export function formatFinding(item, baseDirectory = process.cwd()) {
  const displayPath = path.relative(baseDirectory, item.file) || path.basename(item.file);
  return `${displayPath}:${item.line} ${item.rule}`;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  const targets = process.argv.slice(2);
  try {
    const findings = scanPaths(targets.length > 0 ? targets : [process.cwd()]);
    for (const item of findings) {
      process.stdout.write(`${formatFinding(item)}\n`);
    }
    process.exitCode = findings.length > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to scan target.";
    process.stderr.write(`secret-scan: ${message}\n`);
    process.exitCode = 2;
  }
}
