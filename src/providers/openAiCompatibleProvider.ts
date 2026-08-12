import { parseJsonResponse, parseStructuredOutput } from "./parseStructuredOutput";
import {
  type FetchPort,
  ProviderError,
  type SummaryGenerationRequest,
  type SummaryGenerationResult,
  type SummaryProvider,
} from "./types";
import { OPENROUTER_DEFAULT_MODEL } from "../shared/providerSecretMessages";

export const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";

type OpenRouterProviderOptions = Readonly<{
  model: string;
  getApiKey: () => Promise<string | undefined>;
  fetch?: FetchPort;
}>;

type OpenRouterChatResponse = {
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export class OpenRouterProvider implements SummaryProvider {
  readonly id = "openrouter";

  readonly #model: string;
  readonly #getApiKey: () => Promise<string | undefined>;
  readonly #fetch: FetchPort;

  constructor(options: OpenRouterProviderOptions) {
    this.#model = options.model.trim();
    if (!this.#model) {
      throw new ProviderError(this.id, "A remote model is required.");
    }
    if (this.#model !== OPENROUTER_DEFAULT_MODEL) {
      throw new ProviderError(
        this.id,
        `OpenRouter model must be ${OPENROUTER_DEFAULT_MODEL}.`,
      );
    }
    this.#getApiKey = options.getApiKey;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async generateSummary(
    request: SummaryGenerationRequest,
  ): Promise<SummaryGenerationResult> {
    const apiKey = (await this.#getApiKey())?.trim();
    if (!apiKey) {
      throw new ProviderError(this.id, "Provider API key is not configured.");
    }

    const response = await this.#fetch(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.#model,
        messages: request.messages,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "clinical_summary",
            strict: true,
            schema: request.outputSchema,
          },
        },
        provider: {
          require_parameters: true,
        },
      }),
      signal: request.signal,
    });

    const body = (await parseJsonResponse(
      this.id,
      response,
    )) as OpenRouterChatResponse;
    const output = parseStructuredOutput(
      this.id,
      body.choices?.[0]?.message?.content,
    );

    return {
      providerId: this.id,
      model: typeof body.model === "string" ? body.model : this.#model,
      output,
    };
  }
}
