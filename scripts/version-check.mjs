import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

const readJson = async (relativePath) =>
  JSON.parse(await readFile(resolve(root, relativePath), "utf8"));

const [packageJson, packageLock, manifest] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("public/manifest.json"),
]);

const versions = new Map([
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
  ["public/manifest.json", manifest.version],
]);

const invalid = [...versions].filter(
  ([, version]) => typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version),
);

if (invalid.length > 0) {
  throw new Error(
    `Invalid semantic version: ${invalid
      .map(([source, version]) => `${source}=${String(version)}`)
      .join(", ")}`,
  );
}

const uniqueVersions = new Set(versions.values());

if (uniqueVersions.size !== 1) {
  throw new Error(
    `Version mismatch: ${[...versions]
      .map(([source, version]) => `${source}=${version}`)
      .join(", ")}`,
  );
}

console.log(`Version check passed: ${packageJson.version}`);
