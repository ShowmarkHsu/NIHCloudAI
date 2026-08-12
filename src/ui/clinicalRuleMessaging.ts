import {
  GET_CLINICAL_RULE_RESULTS,
  type ClinicalRuleMessageResponse,
} from "../shared/clinicalRuleMessages";

export interface ClinicalRuleMessaging {
  getResults(): Promise<ClinicalRuleMessageResponse | undefined>;
}

export const chromeClinicalRuleMessaging: ClinicalRuleMessaging = {
  async getResults() {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      throw new Error("Extension messaging is unavailable.");
    }
    return (await chrome.runtime.sendMessage({
      type: GET_CLINICAL_RULE_RESULTS,
    })) as ClinicalRuleMessageResponse | undefined;
  },
};
