import type {
  ProviderConnectionMessageResponse,
  TestProviderConnectionMessage,
} from "../shared/providerConnectionMessages";
import { requestOpenRouterHostPermission } from "./remoteProviderPermission";

export interface ProviderConnectionMessaging {
  test(
    message: TestProviderConnectionMessage,
  ): Promise<ProviderConnectionMessageResponse | undefined>;
  requestRemotePermission(): Promise<boolean>;
}

export const chromeProviderConnectionMessaging: ProviderConnectionMessaging = {
  async test(message) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      throw new Error("Extension messaging is unavailable.");
    }
    return (await chrome.runtime.sendMessage(
      message,
    )) as ProviderConnectionMessageResponse | undefined;
  },

  async requestRemotePermission() {
    return requestOpenRouterHostPermission();
  },
};
