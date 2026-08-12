import type { ProviderSecretVault } from "./sessionSecretVault";
import {
  isProviderSecretMessage,
  type ProviderSecretResponse,
} from "../shared/providerSecretMessages";

function isTrustedExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  const extensionOrigin = chrome.runtime.getURL("");
  return sender.id === chrome.runtime.id && sender.url?.startsWith(extensionOrigin) === true;
}

export function createSecretMessageHandler(vault: ProviderSecretVault) {
  return async (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<ProviderSecretResponse | undefined> => {
    if (!isProviderSecretMessage(message)) return undefined;

    if (!isTrustedExtensionPage(sender)) {
      return { ok: false, error: "Secret operation is not allowed from this context." };
    }

    try {
      if (message.type === "SET_PROVIDER_SECRET") {
        await vault.save(message.providerId, message.apiKey);
        return { ok: true };
      }
      if (message.type === "CLEAR_PROVIDER_SECRET") {
        await vault.clear(message.providerId);
        return { ok: true };
      }
      return { ok: true, configured: await vault.has(message.providerId) };
    } catch {
      return { ok: false, error: "Secret operation failed." };
    }
  };
}
