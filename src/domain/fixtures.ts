import type {
  ClinicalFact,
  ClinicalSummary,
  PatientSnapshot,
  SafetySignal,
  SourceRecord,
} from "./schemas";

/** Synthetic-only identifiers; no real patient data is used in this fixture. */
export const SYNTHETIC_PATIENT_ID = "patient-fictional-001";
export const SYNTHETIC_SESSION_ID = "session-fictional-20260811";

export const syntheticSourceRecords: SourceRecord[] = [
  {
    id: "src-medication-001",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "medication",
    recordedAt: "2026-08-05T09:00:00Z",
    summary: "Metformin 500 mg orally twice daily is marked active.",
    data: {
      synthetic: true,
      medicationName: "Metformin",
      dosage: "500 mg",
      route: "oral",
      frequency: "twice daily",
      status: "active",
    },
  },
  {
    id: "src-medication-002",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "medication",
    recordedAt: "2026-08-05T09:00:00Z",
    summary: "Lisinopril 10 mg orally once daily is marked active.",
    data: {
      synthetic: true,
      medicationName: "Lisinopril",
      dosage: "10 mg",
      route: "oral",
      frequency: "once daily",
      status: "active",
    },
  },
  {
    id: "src-allergy-001",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "allergy",
    recordedAt: "2024-04-12T08:00:00Z",
    summary: "Penicillin allergy with a fictional rash and itching reaction.",
    data: {
      synthetic: true,
      allergen: "Penicillin",
      reaction: "fictional rash and itching",
      severity: "moderate",
    },
  },
  {
    id: "src-lab-001",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "lab",
    recordedAt: "2026-08-07T07:30:00Z",
    summary: "Fasting glucose 168 mg/dL, above the fictional fixture range.",
    data: {
      synthetic: true,
      testName: "Fasting glucose",
      value: 168,
      unit: "mg/dL",
      referenceRange: "70-99 mg/dL (fictional fixture range)",
      interpretation: "high",
    },
  },
  {
    id: "src-lab-002",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "lab",
    recordedAt: "2026-07-01T07:30:00Z",
    summary: "Fasting glucose 142 mg/dL, above the fictional fixture range.",
    data: {
      synthetic: true,
      testName: "Fasting glucose",
      value: 142,
      unit: "mg/dL",
      referenceRange: "70-99 mg/dL (fictional fixture range)",
      interpretation: "high",
    },
  },
  {
    id: "src-imaging-001",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "imaging",
    recordedAt: "2026-08-02T14:00:00Z",
    summary: "Fictional chest radiograph reports no acute cardiopulmonary finding.",
    data: {
      synthetic: true,
      modality: "radiograph",
      conclusion: "No acute fictional cardiopulmonary finding.",
    },
  },
  {
    id: "src-discharge-001",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "discharge",
    recordedAt: "2026-07-22T16:45:00Z",
    summary: "Fictional short-stay observation discharge with home follow-up.",
    data: {
      synthetic: true,
      disposition: "home",
      lengthOfStayDays: 1,
    },
  },
];

export const syntheticPatientSnapshot: PatientSnapshot = {
  patientId: SYNTHETIC_PATIENT_ID,
  sessionId: SYNTHETIC_SESSION_ID,
  capturedAt: "2026-08-11T01:00:00Z",
  records: syntheticSourceRecords,
};

export const syntheticClinicalFacts: ClinicalFact[] = [
  {
    id: "fact-active-medications",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "medication",
    text: "目前快照列有兩項仍標記為使用中的西藥。",
    sourceRefs: ["src-medication-001", "src-medication-002"],
    derived: false,
  },
  {
    id: "fact-glucose-trend",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    type: "trend",
    text: "兩次空腹血糖結果均高於本合成案例的參考範圍，且較近期結果更高。",
    sourceRefs: ["src-lab-001", "src-lab-002"],
    derived: true,
  },
];

export const syntheticSafetySignals: SafetySignal[] = [
  {
    id: "signal-abnormal-glucose",
    patientId: SYNTHETIC_PATIENT_ID,
    sessionId: SYNTHETIC_SESSION_ID,
    kind: "abnormal-lab",
    text: "空腹血糖高於合成參考範圍，請由醫事人員核對原始檢驗紀錄。",
    sourceRefs: ["src-lab-001"],
    severity: "attention",
  },
];

export const syntheticClinicalSummary: ClinicalSummary = {
  patientId: SYNTHETIC_PATIENT_ID,
  sessionId: SYNTHETIC_SESSION_ID,
  generatedAt: "2026-08-11T01:01:00Z",
  provenance: {
    providerId: "synthetic-provider",
    model: "synthetic-provider",
    promptVersion: "clinical-summary-prompt.v1",
    schemaVersion: "clinical-summary.v1",
    rulesVersion: "clinical-rules.v1",
  },
  facts: syntheticClinicalFacts,
  safetySignals: syntheticSafetySignals,
  items: [
    {
      id: "summary-medications",
      section: "medication",
      text: "目前用藥包含 Metformin 500 mg 每日兩次與 Lisinopril 10 mg 每日一次。",
      sourceRefs: ["src-medication-001", "src-medication-002"],
      importance: "routine",
    },
    {
      id: "summary-allergy",
      section: "allergy",
      text: "紀錄顯示對 Penicillin 有過敏反應。",
      sourceRefs: ["src-allergy-001"],
      importance: "attention",
    },
    {
      id: "summary-lab",
      section: "lab",
      text: "近期空腹血糖為 168 mg/dL，前次合成紀錄為 142 mg/dL，兩者均高於參考範圍。",
      sourceRefs: ["src-lab-001", "src-lab-002"],
      importance: "attention",
    },
    {
      id: "summary-imaging",
      section: "imaging",
      text: "胸部影像報告未描述急性心肺異常。",
      sourceRefs: ["src-imaging-001"],
      importance: "routine",
    },
    {
      id: "summary-discharge",
      section: "discharge",
      text: "近期有一筆短期觀察後返家的出院摘要。",
      sourceRefs: ["src-discharge-001"],
      importance: "routine",
    },
  ],
};
