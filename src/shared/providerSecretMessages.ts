export const OPENROUTER_PROVIDER_ID = "openrouter" as const;
export const OPENROUTER_DEFAULT_MODEL = "openai/gpt-oss-120b" as const;

export type ProviderId = "ollama" | typeof OPENROUTER_PROVIDER_ID;
export type ByokProviderId = typeof OPENROUTER_PROVIDER_ID;

export type ProviderSecretMessage =
  | Readonly<{
      type: "SET_PROVIDER_SECRET";
      providerId: ByokProviderId;
      apiKey: string;
    }>
  | Readonly<{
      type: "CLEAR_PROVIDER_SECRET" | "HAS_PROVIDER_SECRET";
      providerId: ByokProviderId;
    }>;

export type ProviderSecretResponse =
  | Readonly<{ ok: true; configured?: boolean }>
  | Readonly<{ ok: false; error: string }>;

export function isProviderSecretMessage(
  value: unknown,
): value is ProviderSecretMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.providerId !== OPENROUTER_PROVIDER_ID) return false;

  if (message.type === "SET_PROVIDER_SECRET") {
    return typeof message.apiKey === "string";
  }

  return (
    message.type === "CLEAR_PROVIDER_SECRET" ||
    message.type === "HAS_PROVIDER_SECRET"
  );
}
