import { z } from "zod";
import type { JsonSchema, SummaryProvider } from "./types";

/**
 * The only payload sent by a provider connection check.  It is deliberately
 * static: callers cannot accidentally add a patient, session, or record to a
 * health check request.
 */
const CONNECTION_CHECK_MESSAGES = [
  {
    role: "system" as const,
    content:
      "Connection check only. This request contains no patient data. Return exactly a JSON object with status \"ok\" and no other fields or text.",
  },
  {
    role: "user" as const,
    content:
      "Return {\"status\":\"ok\"}. Do not include patient, session, record, or any other text.",
  },
] as const;

/** JSON Schema sent to providers for the connection check. */
export const PROVIDER_CONNECTION_CHECK_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: {
      type: "string",
      enum: ["ok"],
    },
  },
};

const ProviderConnectionOutputSchema = z
  .object({
    status: z.literal("ok"),
  })
  .strict();

export type ProviderConnectionResult = Readonly<{
  providerId: string;
  model: string;
}>;

/**
 * Verify that a provider can answer the minimal structured-output request.
 *
 * This function intentionally has no patient/session arguments and does not
 * log or retain the prompt, response, or any provider secret.  The provider
 * transport owns authentication and response parsing; this seam only checks
 * the strict health-check shape before returning non-sensitive metadata.
 */
export async function checkProviderConnection(
  provider: SummaryProvider,
  signal?: AbortSignal,
): Promise<ProviderConnectionResult> {
  const result = await provider.generateSummary({
    messages: CONNECTION_CHECK_MESSAGES,
    outputSchema: PROVIDER_CONNECTION_CHECK_SCHEMA,
    signal,
  });

  // Strict parsing rejects any echoed text or additional fields from a model.
  ProviderConnectionOutputSchema.parse(result.output);

  return {
    providerId: result.providerId,
    model: result.model,
  };
}
