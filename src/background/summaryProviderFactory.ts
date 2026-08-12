import {
  OllamaProvider,
  OpenRouterProvider,
  type FetchPort,
  type SummaryProvider,
} from "../providers";
import type { ProviderId } from "../shared/providerSecretMessages";
import { OPENROUTER_PROVIDER_ID } from "../shared/providerSecretMessages";
import type { ProviderSecretVault } from "./sessionSecretVault";

export type SummaryProviderConfig = Readonly<{
  providerId: ProviderId;
  model: string;
}>;

export type SummaryProviderFactory = (
  config: SummaryProviderConfig,
) => SummaryProvider;

export function createSummaryProviderFactory(options: Readonly<{
  secrets: Pick<ProviderSecretVault, "load">;
  fetch?: FetchPort;
}>): SummaryProviderFactory {
  const fetchPort = options.fetch ?? globalThis.fetch.bind(globalThis);
  return ({ providerId, model }) => {
    if (providerId === "ollama") {
      return new OllamaProvider({ model, fetch: fetchPort });
    }
    return new OpenRouterProvider({
      model,
      getApiKey: () => options.secrets.load(OPENROUTER_PROVIDER_ID),
      fetch: fetchPort,
    });
  };
}
