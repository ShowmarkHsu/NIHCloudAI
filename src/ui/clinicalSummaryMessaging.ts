import {
  GET_CLINICAL_SUMMARY,
  type ClinicalSummaryMessage,
  type ClinicalSummaryMessageResponse,
} from "../shared/clinicalSummaryMessages";
import { requestOpenRouterHostPermission } from "./remoteProviderPermission";

export interface ClinicalSummaryMessaging {
  send(
    message: ClinicalSummaryMessage,
  ): Promise<ClinicalSummaryMessageResponse | undefined>;
  requestRemotePermission(): Promise<boolean>;
}

export const chromeClinicalSummaryMessaging: ClinicalSummaryMessaging = {
  async send(message) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      throw new Error("Extension messaging is unavailable.");
    }
    return (await chrome.runtime.sendMessage(
      message,
    )) as ClinicalSummaryMessageResponse | undefined;
  },

  async requestRemotePermission() {
    return requestOpenRouterHostPermission();
  },
};

export const initialClinicalSummaryMessage = {
  type: GET_CLINICAL_SUMMARY,
} as const;
