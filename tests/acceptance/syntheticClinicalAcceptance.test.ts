import { describe, expect, it } from "vitest";
import {
  evaluateSyntheticAcceptanceCoverage,
  syntheticClinicalAcceptanceStandard,
} from "../../src/acceptance";
import {
  syntheticClinicalSummary,
  syntheticPatientSnapshot,
} from "../../src/domain";
import { CURRENT_CLINICAL_SUMMARY_CONTRACT } from "../../src/summary";

describe("synthetic clinical acceptance standard", () => {
  it("references only source records in the synthetic case", () => {
    const sourceIds = new Set(syntheticPatientSnapshot.records.map((record) => record.id));

    for (const claim of syntheticClinicalAcceptanceStandard.requiredClaims) {
      expect(claim.expectedSourceRefs.length).toBeGreaterThan(0);
      expect(claim.expectedSourceRefs.every((sourceRef) => sourceIds.has(sourceRef))).toBe(true);
    }
  });

  it("gives every acceptance and rejection rule a unique stable id", () => {
    const claimIds = syntheticClinicalAcceptanceStandard.requiredClaims.map((claim) => claim.id);
    const unacceptableIds = syntheticClinicalAcceptanceStandard.unacceptableOutputs.map(
      (output) => output.id,
    );

    expect(new Set(claimIds).size).toBe(claimIds.length);
    expect(new Set(unacceptableIds).size).toBe(unacceptableIds.length);
    expect(syntheticClinicalAcceptanceStandard.unacceptableOutputs.every(
      (output) => output.description.trim() && output.syntheticExample.trim(),
    )).toBe(true);
  });

  it("records physician and pharmacist acceptance for the current rule version", () => {
    expect(syntheticClinicalAcceptanceStandard.thresholds).toEqual({
      completeness: 1,
      sourceSupportAccuracy: 1,
      majorOmissionRate: 0,
      unacceptableOutputCount: 0,
    });
    expect(syntheticClinicalAcceptanceStandard.requiredSignoffRoles.map((role) => role.role)).toEqual([
      "physician",
      "pharmacist",
    ]);
    expect(syntheticClinicalAcceptanceStandard.status).toBe("accepted");
    expect(syntheticClinicalAcceptanceStandard.clinicalSignoff).toEqual({
      decision: "accepted",
      confirmedAt: "2026-08-12",
      roles: ["physician", "pharmacist"],
      scope: "synthetic-mvp-clinical-acceptance-v1 + clinical-rules.v2",
    });
    expect(syntheticClinicalAcceptanceStandard.acceptedVersions).toEqual({
      caseVersion: syntheticClinicalAcceptanceStandard.caseId,
      promptVersion: CURRENT_CLINICAL_SUMMARY_CONTRACT.promptVersion,
      schemaVersion: CURRENT_CLINICAL_SUMMARY_CONTRACT.schemaVersion,
      rulesVersion: CURRENT_CLINICAL_SUMMARY_CONTRACT.rulesVersion,
    });
    expect(syntheticClinicalAcceptanceStandard.currentValidation).toEqual({
      status: "accepted",
      reason: "physician-and-pharmacist-revalidated",
      rulesVersion: CURRENT_CLINICAL_SUMMARY_CONTRACT.rulesVersion,
    });
    expect(CURRENT_CLINICAL_SUMMARY_CONTRACT.rulesVersion).toBe("clinical-rules.v2");
    expect(syntheticClinicalAcceptanceStandard.acceptedVersions.rulesVersion).toBe(
      CURRENT_CLINICAL_SUMMARY_CONTRACT.rulesVersion,
    );
    expect(syntheticClinicalAcceptanceStandard.historicalSignoffs).toContainEqual({
      decision: "accepted",
      confirmedAt: "2026-08-12",
      roles: ["physician", "pharmacist"],
      scope: "synthetic-mvp-clinical-acceptance-v1 + clinical-rules.v1",
    });
  });

  it("structurally covers every required claim in the accepted synthetic summary", () => {
    expect(evaluateSyntheticAcceptanceCoverage(syntheticClinicalSummary)).toEqual({
      coveredClaimIds: syntheticClinicalAcceptanceStandard.requiredClaims.map((claim) => claim.id),
      missingClaimIds: [],
      missingMajorClaimIds: [],
      completeness: 1,
      majorOmissionRate: 0,
    });
  });

  it("detects omission of the major allergy claim", () => {
    const withoutAllergy = {
      items: syntheticClinicalSummary.items.filter((item) => item.section !== "allergy"),
    };

    expect(evaluateSyntheticAcceptanceCoverage(withoutAllergy)).toMatchObject({
      missingClaimIds: ["claim-penicillin-allergy"],
      missingMajorClaimIds: ["claim-penicillin-allergy"],
      completeness: 0.8,
      majorOmissionRate: 1 / 3,
    });
  });
});
