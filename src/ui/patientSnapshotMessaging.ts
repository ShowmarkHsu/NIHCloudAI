import {
  GET_PATIENT_SNAPSHOT_STATUS,
  type PatientSnapshotMessageResponse,
} from "../shared/patientSnapshotMessages";

export interface PatientSnapshotStatusMessaging {
  getStatus(): Promise<PatientSnapshotMessageResponse | undefined>;
}

export const chromePatientSnapshotStatusMessaging: PatientSnapshotStatusMessaging = {
  async getStatus() {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      throw new Error("Extension messaging is unavailable.");
    }
    return (await chrome.runtime.sendMessage({
      type: GET_PATIENT_SNAPSHOT_STATUS,
    })) as PatientSnapshotMessageResponse | undefined;
  },
};
