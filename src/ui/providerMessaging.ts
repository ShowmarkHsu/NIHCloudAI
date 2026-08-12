import type {
  ProviderSecretMessage,
  ProviderSecretResponse,
} from "../shared/providerSecretMessages";

export {
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  type ProviderId,
} from "../shared/providerSecretMessages";

/**
 * The popup only depends on this narrow port, so tests can provide a fake
 * without creating a browser runtime or a real secret vault.
 */
export interface ProviderSecretMessaging {
  send(
    message: ProviderSecretMessage,
  ): Promise<ProviderSecretResponse | undefined>;
}

export const chromeProviderSecretMessaging: ProviderSecretMessaging = {
  async send(message) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      throw new Error("Extension messaging is unavailable.");
    }

    return (await chrome.runtime.sendMessage(message)) as
      | ProviderSecretResponse
      | undefined;
  },
};
