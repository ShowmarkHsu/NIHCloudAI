export type JsonSchema = Readonly<Record<string, unknown>>;

export type ProviderMessage = Readonly<{
  role: "system" | "user";
  content: string;
}>;

export type SummaryGenerationRequest = Readonly<{
  messages: readonly ProviderMessage[];
  outputSchema: JsonSchema;
  signal?: AbortSignal;
}>;

export type SummaryGenerationResult = Readonly<{
  providerId: string;
  model: string;
  output: unknown;
}>;

/**
 * The seam between summary orchestration and an LLM backend.
 * Implementations own transport details, response parsing, and safe errors.
 */
export interface SummaryProvider {
  readonly id: string;
  generateSummary(
    request: SummaryGenerationRequest,
  ): Promise<SummaryGenerationResult>;
}

export type FetchPort = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class ProviderError extends Error {
  readonly providerId: string;
  readonly status?: number;

  constructor(providerId: string, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.providerId = providerId;
    this.status = status;
  }
}
