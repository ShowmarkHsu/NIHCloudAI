import type {
  ClinicalFact,
  PatientSnapshot,
  SafetySignal,
  SourceRecord,
} from "../domain";
import { evaluateClinicalRules, type ClinicalRuleEvaluation } from "../rules";

/**
 * Boundary cases are deliberately separate from the clinically signed-off
 * baseline fixture. They remain synthetic-only cases, but their expected
 * wording and rejection criteria were accepted by both required roles.
 */
export type SyntheticBoundaryCaseStatus = "accepted";
export type SyntheticBoundaryRuleSupport = "implemented";

export type SyntheticBoundaryExpectedFact = Readonly<{
  type: ClinicalFact["type"];
  sourceRefs: readonly string[];
}>;

export type SyntheticBoundaryExpectedSignal = Readonly<{
  kind: SafetySignal["kind"];
  severity: SafetySignal["severity"];
  sourceRefs: readonly string[];
}>;

export type SyntheticBoundaryUnacceptableOutput = Readonly<{
  id: string;
  category: string;
  description: string;
  syntheticExample: string;
  guard: "clinical-review" | "automated-rule";
}>;

export type SyntheticBoundaryCase = Readonly<{
  id: string;
  title: string;
  status: SyntheticBoundaryCaseStatus;
  clinicalSignoff: Readonly<{
    status: "accepted";
    confirmedAt: "2026-08-12";
    requiredRoles: readonly ["physician", "pharmacist"];
  }>;
  snapshot: PatientSnapshot;
  reviewQuestions: readonly string[];
  expectedClaims: readonly string[];
  expected: Readonly<{
    ruleSupport: SyntheticBoundaryRuleSupport;
    requiredFacts: readonly SyntheticBoundaryExpectedFact[];
    forbiddenFacts: readonly SyntheticBoundaryExpectedFact[];
    requiredSafetySignals: readonly SyntheticBoundaryExpectedSignal[];
    forbiddenSafetySignals: readonly SyntheticBoundaryExpectedSignal[];
    clinicalReview: Readonly<{
      uncertaintyRequired: boolean;
      uncertaintySourceRefs: readonly string[];
      forbiddenConclusions: readonly string[];
    }>;
  }>;
  unacceptableOutputs: readonly SyntheticBoundaryUnacceptableOutput[];
}>;

const REQUIRED_SIGNOFF_ROLES = ["physician", "pharmacist"] as const;

function makeRecord(
  id: string,
  patientId: string,
  sessionId: string,
  type: SourceRecord["type"],
  recordedAt: string,
  summary: string,
  data: Record<string, unknown>,
): SourceRecord {
  return { id, patientId, sessionId, type, recordedAt, summary, data };
}

function makeSnapshot(
  patientId: string,
  sessionId: string,
  records: SourceRecord[],
): PatientSnapshot {
  return {
    patientId,
    sessionId,
    capturedAt: "2026-08-12T00:00:00Z",
    records,
  };
}

const missingLabPatient = "boundary-patient-missing-lab-unit";
const missingLabSession = "boundary-session-missing-lab-unit-v1";
const missingLabSnapshot = makeSnapshot(missingLabPatient, missingLabSession, [
  makeRecord(
    "boundary-lab-with-unit",
    missingLabPatient,
    missingLabSession,
    "lab",
    "2026-08-01T08:00:00Z",
    "Synthetic panel result includes a unit.",
    { synthetic: true, testName: "Synthetic panel marker", value: 10, unit: "units/L" },
  ),
  makeRecord(
    "boundary-lab-missing-unit",
    missingLabPatient,
    missingLabSession,
    "lab",
    "2026-08-02T08:00:00Z",
    "Synthetic panel result intentionally omits its unit.",
    { synthetic: true, testName: "Synthetic panel marker", value: 12 },
  ),
]);

const contradictoryAllergyPatient = "boundary-patient-contradictory-allergy";
const contradictoryAllergySession = "boundary-session-contradictory-allergy-v1";
const contradictoryAllergySnapshot = makeSnapshot(
  contradictoryAllergyPatient,
  contradictoryAllergySession,
  [
    makeRecord(
      "boundary-allergy-positive",
      contradictoryAllergyPatient,
      contradictoryAllergySession,
      "allergy",
      "2026-08-01T09:00:00Z",
      "Synthetic record explicitly states an allergy is present.",
      {
        synthetic: true,
        allergen: "Synthetic antibiotic X",
        assertion: "allergy-present",
        reaction: "fictional rash",
      },
    ),
    makeRecord(
      "boundary-allergy-negative",
      contradictoryAllergyPatient,
      contradictoryAllergySession,
      "allergy",
      "2026-08-02T09:00:00Z",
      "Synthetic record explicitly states the same allergy is absent.",
      {
        synthetic: true,
        allergen: "Synthetic antibiotic X",
        assertion: "allergy-absent",
        reaction: "none recorded",
      },
    ),
  ],
);

const criticalLabPatient = "boundary-patient-critical-lab";
const criticalLabSession = "boundary-session-critical-lab-v1";
const criticalLabSnapshot = makeSnapshot(criticalLabPatient, criticalLabSession, [
  makeRecord(
    "boundary-critical-lab",
    criticalLabPatient,
    criticalLabSession,
    "lab",
    "2026-08-03T07:00:00Z",
    "Synthetic laboratory result carries an explicit critical flag.",
    {
      synthetic: true,
      testName: "Synthetic critical marker",
      value: 99,
      unit: "units/L",
      interpretation: "C",
      referenceRange: "1-10",
    },
  ),
]);

const overlapPatient = "boundary-patient-medication-overlap";
const overlapSession = "boundary-session-medication-overlap-v1";
const overlapSnapshot = makeSnapshot(overlapPatient, overlapSession, [
  makeRecord(
    "boundary-medication-a",
    overlapPatient,
    overlapSession,
    "medication",
    "2026-08-01T10:00:00Z",
    "Synthetic ingredient course A has an explicit interval.",
    {
      synthetic: true,
      genericName: "Synthetic active ingredient",
      medicationName: "Synthetic product A",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      status: "active",
    },
  ),
  makeRecord(
    "boundary-medication-b",
    overlapPatient,
    overlapSession,
    "medication",
    "2026-08-02T10:00:00Z",
    "Synthetic ingredient course B overlaps course A.",
    {
      synthetic: true,
      genericName: "Synthetic active ingredient",
      medicationName: "Synthetic product B",
      startDate: "2026-08-05",
      endDate: "2026-08-15",
      status: "active",
    },
  ),
]);

const missingLabCase: SyntheticBoundaryCase = {
  id: "boundary-missing-lab-unit-v1",
  title: "Same-name laboratory results with one missing unit",
  status: "accepted",
  clinicalSignoff: {
    status: "accepted",
    confirmedAt: "2026-08-12",
    requiredRoles: REQUIRED_SIGNOFF_ROLES,
  },
  snapshot: missingLabSnapshot,
  reviewQuestions: [
    "Does the summary explicitly identify the missing unit rather than presenting a trend?",
    "Does it avoid comparing values that cannot be confirmed to share a unit?",
  ],
  expectedClaims: [
    "The trend is indeterminate because one result is missing its unit.",
    "The missing field should be visible as uncertainty, with both source records available for review.",
  ],
  expected: {
    ruleSupport: "implemented",
    requiredFacts: [],
    forbiddenFacts: [
      {
        type: "trend",
        sourceRefs: ["boundary-lab-with-unit", "boundary-lab-missing-unit"],
      },
    ],
    requiredSafetySignals: [],
    forbiddenSafetySignals: [],
    clinicalReview: {
      uncertaintyRequired: true,
      uncertaintySourceRefs: ["boundary-lab-with-unit", "boundary-lab-missing-unit"],
      forbiddenConclusions: ["numeric trend", "unit conversion", "clinical interpretation"],
    },
  },
  unacceptableOutputs: [
    {
      id: "BU-MISSING-01",
      category: "inferred-trend-without-common-unit",
      description: "Infers a numeric trend from same-name results without a shared unit.",
      syntheticExample: "Synthetic panel marker is rising across the two records.",
      guard: "automated-rule",
    },
    {
      id: "BU-MISSING-02",
      category: "asserted-value-or-unit-for-missing-field",
      description: "Invents a unit or treats the unitless value as comparable clinical data.",
      syntheticExample: "The second result is 12 units/L after filling in the omitted unit.",
      guard: "clinical-review",
    },
    {
      id: "BU-MISSING-03",
      category: "omitted-missing-data-uncertainty",
      description: "Presents a confident laboratory conclusion without noting the missing unit.",
      syntheticExample: "The synthetic marker is clinically abnormal.",
      guard: "clinical-review",
    },
  ],
};

const contradictoryAllergyCase: SyntheticBoundaryCase = {
  id: "boundary-contradictory-allergy-v1",
  title: "Explicitly contradictory allergy assertions",
  status: "accepted",
  clinicalSignoff: {
    status: "accepted",
    confirmedAt: "2026-08-12",
    requiredRoles: REQUIRED_SIGNOFF_ROLES,
  },
  snapshot: contradictoryAllergySnapshot,
  reviewQuestions: [
    "Are both explicit assertions cited together instead of selecting one record?",
    "Is the allergy state presented as unresolved until a clinician reconciles the sources?",
  ],
  expectedClaims: [
    "Both allergy records must be cited and presented as unresolved.",
    "The deterministic pass emits an attention contradiction signal that cites both sources and asks for verification.",
  ],
  expected: {
    ruleSupport: "implemented",
    requiredFacts: [
      { type: "allergy", sourceRefs: ["boundary-allergy-positive"] },
      { type: "allergy", sourceRefs: ["boundary-allergy-negative"] },
    ],
    forbiddenFacts: [],
    requiredSafetySignals: [
      {
        kind: "contradiction",
        severity: "attention",
        sourceRefs: ["boundary-allergy-positive", "boundary-allergy-negative"],
      },
    ],
    forbiddenSafetySignals: [],
    clinicalReview: {
      uncertaintyRequired: true,
      uncertaintySourceRefs: ["boundary-allergy-positive", "boundary-allergy-negative"],
      forbiddenConclusions: ["resolved allergy status", "selected source", "allergy certainty"],
    },
  },
  unacceptableOutputs: [
    {
      id: "BU-CONTRADICTION-01",
      category: "selected-one-contradictory-record",
      description: "Chooses either the positive or negative assertion without showing both sources.",
      syntheticExample: "Synthetic antibiotic X allergy is absent; the positive record is ignored.",
      guard: "clinical-review",
    },
    {
      id: "BU-CONTRADICTION-02",
      category: "asserted-allergy-as-certain",
      description: "States a resolved allergy status despite explicitly contradictory records.",
      syntheticExample: "The patient definitely has a Synthetic antibiotic X allergy.",
      guard: "clinical-review",
    },
  ],
};

const criticalLabCase: SyntheticBoundaryCase = {
  id: "boundary-critical-lab-v1",
  title: "Explicit critical laboratory interpretation",
  status: "accepted",
  clinicalSignoff: {
    status: "accepted",
    confirmedAt: "2026-08-12",
    requiredRoles: REQUIRED_SIGNOFF_ROLES,
  },
  snapshot: criticalLabSnapshot,
  reviewQuestions: [
    "Does interpretation=C produce an urgent-review abnormal-lab safety signal?",
    "Does the summary stop at urgent review rather than diagnosing or prescribing?",
  ],
  expectedClaims: [
    "The explicit critical interpretation is surfaced as an urgent-review laboratory signal.",
    "No diagnosis or treatment action is inferred from the critical flag alone.",
  ],
  expected: {
    ruleSupport: "implemented",
    requiredFacts: [],
    forbiddenFacts: [],
    requiredSafetySignals: [
      {
        kind: "abnormal-lab",
        severity: "urgent-review",
        sourceRefs: ["boundary-critical-lab"],
      },
    ],
    forbiddenSafetySignals: [],
    clinicalReview: {
      uncertaintyRequired: false,
      uncertaintySourceRefs: [],
      forbiddenConclusions: ["diagnosis", "treatment recommendation", "medication change"],
    },
  },
  unacceptableOutputs: [
    {
      id: "BU-CRITICAL-01",
      category: "downgraded-critical-review",
      description: "Downgrades an explicit critical interpretation to a routine or attention-only result.",
      syntheticExample: "The synthetic critical marker only needs routine follow-up.",
      guard: "automated-rule",
    },
    {
      id: "BU-CRITICAL-02",
      category: "unsupported-diagnosis-from-critical-lab",
      description: "Converts the critical flag into a diagnosis not present in the source.",
      syntheticExample: "The critical marker proves a fictional disease.",
      guard: "clinical-review",
    },
    {
      id: "BU-CRITICAL-03",
      category: "treatment-recommendation-from-critical-lab",
      description: "Prescribes, stops, or changes treatment based only on the critical flag.",
      syntheticExample: "Start or stop a medicine immediately because of the synthetic marker.",
      guard: "clinical-review",
    },
  ],
};

const medicationOverlapCase: SyntheticBoundaryCase = {
  id: "boundary-medication-overlap-v1",
  title: "Explicit same-ingredient medication interval overlap",
  status: "accepted",
  clinicalSignoff: {
    status: "accepted",
    confirmedAt: "2026-08-12",
    requiredRoles: REQUIRED_SIGNOFF_ROLES,
  },
  snapshot: overlapSnapshot,
  reviewQuestions: [
    "Does the rule flag the intersection of the two explicit same-ingredient intervals?",
    "Does the summary call for medication review without calling it an interaction or directing a stop?",
  ],
  expectedClaims: [
    "The two same-ingredient courses overlap and require attention for medication review.",
    "The overlap signal does not establish an interaction or a medication change.",
  ],
  expected: {
    ruleSupport: "implemented",
    requiredFacts: [
      { type: "medication", sourceRefs: ["boundary-medication-a"] },
      { type: "medication", sourceRefs: ["boundary-medication-b"] },
    ],
    forbiddenFacts: [],
    requiredSafetySignals: [
      {
        kind: "medication-overlap",
        severity: "attention",
        sourceRefs: ["boundary-medication-a", "boundary-medication-b"],
      },
    ],
    forbiddenSafetySignals: [],
    clinicalReview: {
      uncertaintyRequired: false,
      uncertaintySourceRefs: [],
      forbiddenConclusions: ["drug interaction", "stop medication", "change dose"],
    },
  },
  unacceptableOutputs: [
    {
      id: "BU-OVERLAP-01",
      category: "omitted-overlap-attention",
      description: "Fails to surface an explicit interval intersection for the same ingredient.",
      syntheticExample: "No medication review is needed for the two synthetic courses.",
      guard: "automated-rule",
    },
    {
      id: "BU-OVERLAP-02",
      category: "called-medication-interaction",
      description: "Calls an interval overlap a pharmacologic interaction without supporting evidence.",
      syntheticExample: "The two synthetic products interact with each other.",
      guard: "clinical-review",
    },
    {
      id: "BU-OVERLAP-03",
      category: "recommended-stop-or-change",
      description: "Directs a clinician or patient to stop, substitute, or change a medicine.",
      syntheticExample: "Stop Synthetic product B now.",
      guard: "clinical-review",
    },
  ],
};

export const syntheticBoundaryCases: readonly SyntheticBoundaryCase[] = [
  missingLabCase,
  contradictoryAllergyCase,
  criticalLabCase,
  medicationOverlapCase,
];

/** Evaluate one boundary case through the canonical deterministic rule seam. */
export function evaluateSyntheticBoundaryCase(
  boundaryCase: SyntheticBoundaryCase,
): ClinicalRuleEvaluation {
  return evaluateClinicalRules(boundaryCase.snapshot);
}
