import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  RULES,
  scanDirectory,
  scanText,
} from "../../scripts/secret-scan.mjs";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nicloudai-secret-scan-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("secret scanner", () => {
  it("reports common credential rules with file and line only", () => {
    const keyPrefix = ["s", "k", "-"].join("");
    const key = keyPrefix + "a".repeat(24);
    const bearer = "b".repeat(24);
    const privateHeader = ["-----BEGIN ", "RSA ", "PRIVATE KEY-----"].join("");
    const viteName = ["VITE", "_", "SERVICE", "_", "TOKEN"].join("");
    const source = [
      `const value = "${key}";`,
      `const headers = { Authorization: "Bearer ${bearer}" };`,
      privateHeader,
      `const ${viteName} = "runtime";`,
    ].join("\n");

    const findings = scanText(source, "fixture.ts");

    expect(findings).toEqual([
      { file: "fixture.ts", line: 1, rule: RULES.PROVIDER_KEY },
      { file: "fixture.ts", line: 2, rule: RULES.AUTHORIZATION_BEARER },
      { file: "fixture.ts", line: 3, rule: RULES.PRIVATE_KEY_HEADER },
      { file: "fixture.ts", line: 4, rule: RULES.VITE_SECRET_VARIABLE },
    ]);
    expect(JSON.stringify(findings)).not.toContain(key);
    expect(JSON.stringify(findings)).not.toContain(bearer);
  });

  it("detects sensitive assignments while ignoring explicit placeholders", () => {
    const apiName = ["API", "_", "KEY"].join("");
    const tokenName = ["access", "_", "token"].join("");
    const source = [
      `${apiName} = "${"q".repeat(20)}"`,
      `${tokenName}: "${"r".repeat(20)}"`,
      `${apiName} = "placeholder"`,
      "const secretPrefix = \"provider-secret:\"",
    ].join("\n");

    const findings = scanText(source, "config.env");

    expect(findings).toEqual([
      { file: "config.env", line: 1, rule: RULES.SECRET_ASSIGNMENT },
      { file: "config.env", line: 2, rule: RULES.SECRET_ASSIGNMENT },
    ]);
  });

  it("does not treat forwarded apiKey properties as embedded secrets", () => {
    const forwarded = scanText(
      "function forward(source) { return { apiKey: source.apiKey }; }",
      "bundle.js",
    );
    const field = ["api", "_", "key"].join("");
    const literal = "m".repeat(24);
    const embedded = scanText(`${field}: "${literal}"`, "bundle.js");

    expect(forwarded).toEqual([]);
    expect(embedded).toEqual([
      { file: "bundle.js", line: 1, rule: RULES.SECRET_ASSIGNMENT },
    ]);
  });

  it("recursively scans source and dist but skips dependencies, coverage, and lockfiles", () => {
    const root = makeTemporaryDirectory();
    const secret = ["s", "k", "-"].join("") + "z".repeat(24);
    mkdirSync(path.join(root, "src"));
    mkdirSync(path.join(root, "dist"));
    mkdirSync(path.join(root, "node_modules", "ignored"), { recursive: true });
    mkdirSync(path.join(root, "coverage"));

    writeFileSync(path.join(root, "src", "source.ts"), `const key = "${secret}";\n`, "utf8");
    writeFileSync(path.join(root, "dist", "bundle.js"), `const key = "${secret}";\n`, "utf8");
    writeFileSync(path.join(root, "node_modules", "ignored", "dep.js"), `const key = "${secret}";\n`, "utf8");
    writeFileSync(path.join(root, "coverage", "report.js"), `const key = "${secret}";\n`, "utf8");
    writeFileSync(path.join(root, "package-lock.json"), `const key = "${secret}";\n`, "utf8");

    const findings = scanDirectory(root);

    expect(findings).toHaveLength(2);
    expect(findings.map(({ file }) => path.basename(file)).sort()).toEqual([
      "bundle.js",
      "source.ts",
    ]);
  });

  it("returns a nonzero CLI status and never prints the secret", () => {
    const root = makeTemporaryDirectory();
    const secret = ["s", "k", "-"].join("") + "c".repeat(24);
    writeFileSync(path.join(root, "leak.js"), `const key = "${secret}";\n`, "utf8");

    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/secret-scan.mjs"), root],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("leak.js:1");
    expect(result.stdout).toContain(RULES.PROVIDER_KEY);
    expect(result.stdout).not.toContain(secret);
  });
});
