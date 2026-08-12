import { describe, expect, it, vi } from "vitest";
import {
  OllamaProvider,
  OpenRouterProvider,
  type FetchPort,
} from "../../src/providers";
import {
  SYNTHETIC_PATIENT_ID,
  SYNTHETIC_SESSION_ID,
  syntheticClinicalFacts,
  syntheticClinicalSummary,
  syntheticPatientSnapshot,
  syntheticSafetySignals,
} from "../../src/domain";
import { generateClinicalSummary } from "../../src/summary";

const TEST_ONLY_API_KEY = "test-only-placeholder";
const GOLDEN_MODEL_OUTPUT = {
  items: syntheticClinicalSummary.items,
};

type CapturedRequest = Readonly<{
  input: string;
  init?: RequestInit;
  body: Record<string, unknown>;
}>;

function createGoldenFetch(
  response: Record<string, unknown>,
  onRequest?: (request: CapturedRequest) => void,
): { fetch: FetchPort; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetch: FetchPort = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const request = { input: String(input), init, body };
    requests.push(request);
    onRequest?.(request);
    return new Response(JSON.stringify(response), { status: 200 });
  };
  return { fetch, requests };
}

async function generateGoldenSummary(
  provider: OllamaProvider | OpenRouterProvider,
) {
  return generateClinicalSummary({
    snapshot: syntheticPatientSnapshot,
    facts: syntheticClinicalFacts,
    safetySignals: syntheticSafetySignals,
    provider,
    now: () => new Date("2026-08-11T02:00:00.000Z"),
  });
}

function assertPromptIsIdentityFree(body: Record<string, unknown>): void {
  const messages = body.messages as readonly { content: string }[];
  const prompt = messages.map((message) => message.content).join("\n");
  expect(prompt).not.toContain(SYNTHETIC_PATIENT_ID);
  expect(prompt).not.toContain(SYNTHETIC_SESSION_ID);
}

describe("provider golden summaries", () => {
  it("runs Ollama through generateClinicalSummary with source validation", async () => {
    const { fetch, requests } = createGoldenFetch({
      model: "golden-ollama-model",
      message: { content: JSON.stringify(GOLDEN_MODEL_OUTPUT) },
    }, (request) => {
      expect(request.input).toBe("http://localhost:11434/api/chat");
      expect(request.init?.headers).toEqual({ "Content-Type": "application/json" });
      assertPromptIsIdentityFree(request.body);
    });
    const provider = new OllamaProvider({
      model: "golden-ollama-model",
      fetch,
    });

    const summary = await generateGoldenSummary(provider);

    expect(summary).toMatchObject({
      patientId: SYNTHETIC_PATIENT_ID,
      sessionId: SYNTHETIC_SESSION_ID,
      provenance: {
        providerId: "ollama",
        model: "golden-ollama-model",
      },
      items: GOLDEN_MODEL_OUTPUT.items,
    });
    expect(requests).toHaveLength(1);
  });

  it("runs OpenRouter BYOK through transport-only authorization", async () => {
    const { fetch, requests } = createGoldenFetch({
      model: "golden-remote-model",
      choices: [{ message: { content: JSON.stringify(GOLDEN_MODEL_OUTPUT) } }],
    }, (request) => {
      expect(request.input).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(request.init?.headers).toMatchObject({
        Authorization: `Bearer ${TEST_ONLY_API_KEY}`,
      });
      expect(JSON.stringify(request.body)).not.toContain(TEST_ONLY_API_KEY);
      expect(request.body).toMatchObject({
        model: "openai/gpt-oss-120b",
        provider: { require_parameters: true },
      });
      assertPromptIsIdentityFree(request.body);
    });
    const provider = new OpenRouterProvider({
      model: "openai/gpt-oss-120b",
      getApiKey: async () => TEST_ONLY_API_KEY,
      fetch,
    });

    const summary = await generateGoldenSummary(provider);

    expect(summary).toMatchObject({
      patientId: SYNTHETIC_PATIENT_ID,
      sessionId: SYNTHETIC_SESSION_ID,
      provenance: {
        providerId: "openrouter",
        model: "golden-remote-model",
      },
      items: GOLDEN_MODEL_OUTPUT.items,
    });
    expect(requests).toHaveLength(1);
  });

  it("keeps the golden transport deterministic and never falls back to network fetch", async () => {
    const networkFetch = vi.fn(async () => {
      throw new Error("network access is disabled in golden tests");
    });
    const { fetch } = createGoldenFetch({
      model: "golden-ollama-model",
      message: { content: JSON.stringify(GOLDEN_MODEL_OUTPUT) },
    });
    const provider = new OllamaProvider({
      model: "golden-ollama-model",
      fetch,
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", networkFetch);

    try {
      await expect(generateGoldenSummary(provider)).resolves.toMatchObject({
        provenance: {
          providerId: "ollama",
          model: "golden-ollama-model",
        },
      });
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
