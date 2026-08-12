import { describe, expect, it, vi } from "vitest";
import {
  OllamaProvider,
  OpenRouterProvider,
  ProviderError,
} from "../../src/providers";

const request = {
  messages: [
    { role: "system" as const, content: "Return grounded JSON." },
    { role: "user" as const, content: "Synthetic patient snapshot." },
  ],
  outputSchema: {
    type: "object",
    properties: { items: { type: "array" } },
    required: ["items"],
    additionalProperties: false,
  },
};

describe("OllamaProvider", () => {
  it("uses the local structured-output endpoint without authorization", async () => {
    const fetch = vi.fn(async (_input, init) => {
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "synthetic-model",
        stream: false,
        format: request.outputSchema,
      });
      return new Response(
        JSON.stringify({
          model: "synthetic-model",
          message: { content: JSON.stringify({ items: [] }) },
        }),
        { status: 200 },
      );
    });

    const provider = new OllamaProvider({
      model: "synthetic-model",
      fetch,
    });

    await expect(provider.generateSummary(request)).resolves.toMatchObject({
      providerId: "ollama",
      output: { items: [] },
    });
  });

  it("rejects non-local Ollama endpoints", () => {
    expect(
      () =>
        new OllamaProvider({
          model: "synthetic-model",
          baseUrl: "https://example.invalid",
        }),
    ).toThrow(ProviderError);
  });
});

describe("OpenRouterProvider", () => {
  it("adds the session key only inside the trusted transport adapter", async () => {
    const fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer test-only-placeholder",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "openai/gpt-oss-120b",
        provider: { require_parameters: true },
        response_format: { type: "json_schema" },
      });
      return new Response(
        JSON.stringify({
          model: "synthetic-remote-model",
          choices: [{ message: { content: JSON.stringify({ items: [] }) } }],
        }),
        { status: 200 },
      );
    });

    const provider = new OpenRouterProvider({
      model: "openai/gpt-oss-120b",
      getApiKey: async () => "test-only-placeholder",
      fetch,
    });

    await expect(provider.generateSummary(request)).resolves.toMatchObject({
      providerId: "openrouter",
      output: { items: [] },
    });
  });

  it("rejects a remote model outside the fixed OpenRouter decision", () => {
    expect(
      () =>
        new OpenRouterProvider({
          model: "synthetic-model",
          getApiKey: async () => "test-only-placeholder",
        }),
    ).toThrow("OpenRouter model must be openai/gpt-oss-120b.");
  });

  it("does not expose third-party response bodies in errors", async () => {
    const provider = new OpenRouterProvider({
      model: "openai/gpt-oss-120b",
      getApiKey: async () => "test-only-placeholder",
      fetch: async () =>
        new Response("sensitive remote response", { status: 401 }),
    });

    await expect(provider.generateSummary(request)).rejects.not.toThrow(
      "sensitive remote response",
    );
  });
});
