import {
  type FetchPort,
  ProviderError,
  type SummaryGenerationRequest,
  type SummaryGenerationResult,
  type SummaryProvider,
} from "./types";
import { parseJsonResponse, parseStructuredOutput } from "./parseStructuredOutput";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

type OllamaProviderOptions = Readonly<{
  model: string;
  baseUrl?: string;
  fetch?: FetchPort;
}>;

type OllamaChatResponse = {
  model?: unknown;
  message?: {
    content?: unknown;
  };
};

export class OllamaProvider implements SummaryProvider {
  readonly id = "ollama";

  readonly #model: string;
  readonly #endpoint: string;
  readonly #fetch: FetchPort;

  constructor(options: OllamaProviderOptions) {
    const model = options.model.trim();
    if (!model) {
      throw new ProviderError(this.id, "An Ollama model is required.");
    }

    const baseUrl = new URL(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
    if (
      baseUrl.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(baseUrl.hostname)
    ) {
      throw new ProviderError(
        this.id,
        "Ollama must use a localhost HTTP endpoint.",
      );
    }

    this.#model = model;
    this.#endpoint = new URL("/api/chat", baseUrl).toString();
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async generateSummary(
    request: SummaryGenerationRequest,
  ): Promise<SummaryGenerationResult> {
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.#model,
        messages: request.messages,
        stream: false,
        format: request.outputSchema,
        options: { temperature: 0 },
      }),
      signal: request.signal,
    });

    const body = (await parseJsonResponse(this.id, response)) as OllamaChatResponse;
    const output = parseStructuredOutput(this.id, body.message?.content);

    return {
      providerId: this.id,
      model: typeof body.model === "string" ? body.model : this.#model,
      output,
    };
  }
}
