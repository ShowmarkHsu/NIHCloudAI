import { ProviderError } from "./types";

export function parseStructuredOutput(
  providerId: string,
  content: unknown,
): unknown {
  if (typeof content !== "string" || content.trim() === "") {
    throw new ProviderError(providerId, "Provider returned no summary content.");
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ProviderError(
      providerId,
      "Provider returned invalid structured output.",
    );
  }
}

export async function parseJsonResponse(
  providerId: string,
  response: Response,
): Promise<unknown> {
  if (!response.ok) {
    // Deliberately do not include the response body. Third-party error bodies can
    // echo prompts or credentials and must never be surfaced through logs/errors.
    throw new ProviderError(
      providerId,
      `Provider request failed with HTTP ${response.status}.`,
      response.status,
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ProviderError(providerId, "Provider returned invalid JSON.");
  }
}
