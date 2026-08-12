import { readFile } from "node:fs/promises";

const manifestPath = new URL("../dist-smoke/manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const serialized = JSON.stringify(manifest);

const expectedMatch = "http://127.0.0.1/smoke/*";
if (
  manifest.name !== "NICloudAI Synthetic Smoke" ||
  !manifest.content_scripts?.some((entry) => entry.matches?.includes(expectedMatch)) ||
  serialized.includes("medcloud2.nhi.gov.tw") ||
  serialized.includes("api.openai.com")
) {
  throw new Error(
    "dist-smoke manifest must be synthetic-only and must not include NHI or remote Provider origins.",
  );
}

console.log("Synthetic smoke manifest verified.");
