import { syntheticPatientSnapshot } from "../src/domain";
import {
  OllamaProvider,
  ProviderError,
  checkProviderConnection,
} from "../src/providers";
import { evaluateClinicalRules } from "../src/rules";
import { generateClinicalSummary } from "../src/summary";

type SmokeStep = "connection" | "summary" | "cancellation" | "provider-error";

type SmokeReport = Readonly<{
  model: string;
  passed: readonly SmokeStep[];
  summaryItemCount: number;
  citedSourceCount: number;
}>;

function parseModel(argv: readonly string[]): string {
  const modelFlag = argv.indexOf("--model");
  const model = modelFlag >= 0 ? argv[modelFlag + 1]?.trim() : undefined;
  if (!model || model.length > 128 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new Error("Pass an installed Ollama model with --model <name>.");
  }
  return model;
}

function isCancellation(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /abort/i.test(`${error.name} ${error.message}`))
  );
}

async function expectCancellation(model: string): Promise<void> {
  const controller = new AbortController();
  const request = checkProviderConnection(
    new OllamaProvider({ model }),
    controller.signal,
  );
  controller.abort();
  try {
    await request;
  } catch (error) {
    if (isCancellation(error)) return;
    throw new Error("Ollama cancellation returned an unexpected error type.");
  }
  throw new Error("Ollama request completed before cancellation was observed.");
}

async function expectMissingModelError(): Promise<void> {
  try {
    await checkProviderConnection(
      new OllamaProvider({ model: "nicloudai-smoke-model-does-not-exist" }),
    );
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) return;
    throw new Error("Missing Ollama model returned an unexpected error type.");
  }
  throw new Error("A missing Ollama model unexpectedly passed the connection check.");
}

async function run(): Promise<SmokeReport> {
  const model = parseModel(process.argv.slice(2));
  const passed: SmokeStep[] = [];
  const provider = new OllamaProvider({ model });

  await checkProviderConnection(provider);
  passed.push("connection");

  const { facts, safetySignals } = evaluateClinicalRules(
    syntheticPatientSnapshot,
  );
  const summary = await generateClinicalSummary({
    snapshot: syntheticPatientSnapshot,
    facts,
    safetySignals,
    provider,
    now: () => new Date("2026-08-12T00:00:00.000Z"),
  });
  passed.push("summary");

  const validSourceRefs = new Set(
    syntheticPatientSnapshot.records.map((record) => record.id),
  );
  const citedSourceRefs = new Set(
    summary.items.flatMap((item) => item.sourceRefs),
  );
  if (
    summary.items.length === 0 ||
    citedSourceRefs.size === 0 ||
    [...citedSourceRefs].some((sourceRef) => !validSourceRefs.has(sourceRef))
  ) {
    throw new Error("The Ollama summary did not retain valid synthetic source references.");
  }

  await expectCancellation(model);
  passed.push("cancellation");

  await expectMissingModelError();
  passed.push("provider-error");

  return {
    model,
    passed,
    summaryItemCount: summary.items.length,
    citedSourceCount: citedSourceRefs.size,
  };
}

try {
  const report = await run();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const safeMessage = error instanceof Error ? error.message : "Unknown smoke failure.";
  console.error(`Ollama smoke failed: ${safeMessage}`);
  process.exitCode = 1;
}
