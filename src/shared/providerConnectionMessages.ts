import type { ProviderId } from "./providerSecretMessages";

export const TEST_PROVIDER_CONNECTION = "TEST_PROVIDER_CONNECTION" as const;

export type TestProviderConnectionMessage = Readonly<{
  type: typeof TEST_PROVIDER_CONNECTION;
  providerId: ProviderId;
  model: string;
}>;

export type ProviderConnectionErrorCode =
  | "INVALID_REQUEST"
  | "API_KEY_MISSING"
  | "PROVIDER_FAILED"
  | "INVALID_OUTPUT"
  | "TIMED_OUT";

export type ProviderConnectionMessageResponse =
  | Readonly<{
      ok: true;
      result: Readonly<{ providerId: string; model: string }>;
    }>
  | Readonly<{
      ok: false;
      errorCode: ProviderConnectionErrorCode;
      error: string;
    }>;
