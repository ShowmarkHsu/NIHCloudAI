import type {
  SourceRecordType,
  SummaryProvenance,
  SummaryImportance,
  SummaryItemSection,
} from "../domain";
import type { ProviderId } from "./providerSecretMessages";

export const GENERATE_CLINICAL_SUMMARY = "GENERATE_CLINICAL_SUMMARY" as const;
export const GET_CLINICAL_SUMMARY = "GET_CLINICAL_SUMMARY" as const;
export const CANCEL_CLINICAL_SUMMARY = "CANCEL_CLINICAL_SUMMARY" as const;

export type GenerateClinicalSummaryMessage = Readonly<{
  type: typeof GENERATE_CLINICAL_SUMMARY;
  providerId: ProviderId;
  model: string;
  remoteDataConsent?: boolean;
}>;

export type GetClinicalSummaryMessage = Readonly<{
  type: typeof GET_CLINICAL_SUMMARY;
}>;

export type CancelClinicalSummaryMessage = Readonly<{
  type: typeof CANCEL_CLINICAL_SUMMARY;
}>;

export type ClinicalSummaryMessage =
  | GenerateClinicalSummaryMessage
  | GetClinicalSummaryMessage
  | CancelClinicalSummaryMessage;

export type SummarySourcePreview = Readonly<{
  id: string;
  type: SourceRecordType;
  recordedAt: string;
  summary: string;
}>;

export type ClinicalSummaryItemView = Readonly<{
  id: string;
  section: SummaryItemSection;
  text: string;
  sourceRefs: readonly string[];
  importance: SummaryImportance;
}>;

/** A popup-safe projection: opaque patient/session identifiers stay in background. */
export type ClinicalSummaryView = Readonly<{
  generatedAt: string;
  provenance: SummaryProvenance;
  items: readonly ClinicalSummaryItemView[];
  sources: readonly SummarySourcePreview[];
}>;

export type ClinicalSummaryState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "ready"; summary: ClinicalSummaryView }>;

export type ClinicalSummaryErrorCode =
  | "NO_SNAPSHOT"
  | "INVALID_REQUEST"
  | "REMOTE_CONSENT_REQUIRED"
  | "API_KEY_MISSING"
  | "PROVIDER_FAILED"
  | "INVALID_OUTPUT"
  | "TIMED_OUT"
  | "CANCELLED"
  | "STALE_SESSION"
  | "INTERNAL_ERROR";

export type ClinicalSummaryMessageResponse =
  | Readonly<{ ok: true; state: ClinicalSummaryState }>
  | Readonly<{
      ok: false;
      errorCode: ClinicalSummaryErrorCode;
      error: string;
    }>;
