import { describe, expect, it } from "vitest";

import {
  evaluateSyntheticBoundaryCase,
  syntheticBoundaryCases,
} from "../../src/acceptance";
import { PatientSnapshotSchema } from "../../src/domain";

function sameRefs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((ref) => right.includes(ref));
}

describe("synthetic boundary clinical acceptance cases", () => {
  it("keeps four accepted, synthetic-only cases isolated by patient and session", () => {
    expect(syntheticBoundaryCases).toHaveLength(4);
    expect(new Set(syntheticBoundaryCases.map((boundaryCase) => boundaryCase.id)).size).toBe(4);
    const allUnacceptableIds = syntheticBoundaryCases.flatMap((boundaryCase) =>
      boundaryCase.unacceptableOutputs.map((output) => output.id),
    );
    expect(new Set(allUnacceptableIds).size).toBe(allUnacceptableIds.length);

    for (const boundaryCase of syntheticBoundaryCases) {
      expect(boundaryCase.status).toBe("accepted");
      expect(boundaryCase.clinicalSignoff.status).toBe("accepted");
      expect(boundaryCase.clinicalSignoff.confirmedAt).toBe("2026-08-12");
      expect(boundaryCase.clinicalSignoff.requiredRoles).toEqual(["physician", "pharmacist"]);
      expect(boundaryCase.reviewQuestions.length).toBeGreaterThan(0);
      expect(boundaryCase.expectedClaims.length).toBeGreaterThan(0);
      expect(boundaryCase.unacceptableOutputs.length).toBeGreaterThan(0);

      const snapshot = PatientSnapshotSchema.parse(boundaryCase.snapshot);
      const sourceIds = new Set(snapshot.records.map((record) => record.id));
      expect(snapshot.records.every(
        (record) => record.patientId === snapshot.patientId && record.sessionId === snapshot.sessionId,
      )).toBe(true);
      expect(snapshot.records.every((record) => record.data.synthetic === true)).toBe(true);
      expect(boundaryCase.expected.clinicalReview.forbiddenConclusions.length).toBeGreaterThan(0);
      expect(boundaryCase.expected.clinicalReview.uncertaintySourceRefs.every(
        (sourceRef) => sourceIds.has(sourceRef),
      )).toBe(true);
      expect(boundaryCase.expected.requiredFacts.every(
        (fact) => fact.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)),
      )).toBe(true);
      expect(boundaryCase.expected.forbiddenFacts.every(
        (fact) => fact.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)),
      )).toBe(true);
      expect(boundaryCase.expected.requiredSafetySignals.every(
        (signal) => signal.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)),
      )).toBe(true);
      expect(boundaryCase.expected.forbiddenSafetySignals.every(
        (signal) => signal.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)),
      )).toBe(true);
      const unacceptableIds = boundaryCase.unacceptableOutputs.map((output) => output.id);
      expect(new Set(unacceptableIds).size).toBe(unacceptableIds.length);
      expect(boundaryCase.unacceptableOutputs.every(
        (output) => output.description.trim() && output.syntheticExample.trim(),
      )).toBe(true);
    }
  });

  it("matches every declared deterministic expectation at the rule seam", () => {
    for (const boundaryCase of syntheticBoundaryCases) {
      const result = evaluateSyntheticBoundaryCase(boundaryCase);
      const sourceIds = new Set(boundaryCase.snapshot.records.map((record) => record.id));

      expect(result.facts.every(
        (fact) =>
          fact.patientId === boundaryCase.snapshot.patientId &&
          fact.sessionId === boundaryCase.snapshot.sessionId &&
          fact.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)),
      )).toBe(true);
      expect(result.safetySignals.every(
        (signal) =>
          signal.patientId === boundaryCase.snapshot.patientId &&
          signal.sessionId === boundaryCase.snapshot.sessionId &&
          signal.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)),
      )).toBe(true);

      for (const expectedFact of boundaryCase.expected.requiredFacts) {
        expect(result.facts.some(
          (fact) => fact.type === expectedFact.type && sameRefs(fact.sourceRefs, expectedFact.sourceRefs),
        )).toBe(true);
      }
      for (const forbiddenFact of boundaryCase.expected.forbiddenFacts) {
        expect(result.facts.some(
          (fact) => fact.type === forbiddenFact.type && sameRefs(fact.sourceRefs, forbiddenFact.sourceRefs),
        )).toBe(false);
      }
      for (const expectedSignal of boundaryCase.expected.requiredSafetySignals) {
        expect(result.safetySignals.some(
          (signal) =>
            signal.kind === expectedSignal.kind &&
            signal.severity === expectedSignal.severity &&
            sameRefs(signal.sourceRefs, expectedSignal.sourceRefs),
        )).toBe(true);
      }
      for (const forbiddenSignal of boundaryCase.expected.forbiddenSafetySignals) {
        expect(result.safetySignals.some(
          (signal) =>
            signal.kind === forbiddenSignal.kind &&
            signal.severity === forbiddenSignal.severity &&
            sameRefs(signal.sourceRefs, forbiddenSignal.sourceRefs),
        )).toBe(false);
      }
    }
  });

  it("does not infer a trend when one same-name lab result is missing its unit", () => {
    const boundaryCase = syntheticBoundaryCases.find(
      (candidate) => candidate.id === "boundary-missing-lab-unit-v1",
    );
    expect(boundaryCase).toBeDefined();

    const result = evaluateSyntheticBoundaryCase(boundaryCase!);
    expect(result.facts.some((fact) => fact.type === "trend")).toBe(false);
    expect(result.safetySignals).toEqual([]);
    expect(boundaryCase?.expectedClaims).toContain(
      "The trend is indeterminate because one result is missing its unit.",
    );
    expect(boundaryCase?.unacceptableOutputs.map((output) => output.category)).toContain(
      "inferred-trend-without-common-unit",
    );
  });

  it("retains both contradictory allergy facts and emits a source-backed attention signal", () => {
    const boundaryCase = syntheticBoundaryCases.find(
      (candidate) => candidate.id === "boundary-contradictory-allergy-v1",
    );
    expect(boundaryCase).toBeDefined();

    const result = evaluateSyntheticBoundaryCase(boundaryCase!);
    expect(result.facts.filter((fact) => fact.type === "allergy")).toHaveLength(2);
    expect(result.facts.filter((fact) => fact.type === "allergy").map((fact) => fact.sourceRefs[0]))
      .toEqual(["boundary-allergy-negative", "boundary-allergy-positive"]);
    expect(result.safetySignals).toHaveLength(1);
    expect(result.safetySignals[0]).toMatchObject({
      kind: "contradiction",
      severity: "attention",
      sourceRefs: ["boundary-allergy-negative", "boundary-allergy-positive"],
    });
    expect(boundaryCase?.expected.ruleSupport).toBe("implemented");
    expect(boundaryCase?.expected.clinicalReview.uncertaintyRequired).toBe(true);
    expect(boundaryCase?.expected.clinicalReview.uncertaintySourceRefs).toEqual([
      "boundary-allergy-positive",
      "boundary-allergy-negative",
    ]);
    expect(boundaryCase?.unacceptableOutputs.map((output) => output.category)).toEqual(
      expect.arrayContaining([
        "selected-one-contradictory-record",
        "asserted-allergy-as-certain",
      ]),
    );
    expect(boundaryCase?.unacceptableOutputs.map((output) => output.category)).not.toContain(
      "claimed-contradiction-rule-as-implemented",
    );
  });

  it("turns an explicit critical interpretation into urgent review only", () => {
    const boundaryCase = syntheticBoundaryCases.find(
      (candidate) => candidate.id === "boundary-critical-lab-v1",
    );
    expect(boundaryCase).toBeDefined();

    const result = evaluateSyntheticBoundaryCase(boundaryCase!);
    expect(result.safetySignals).toHaveLength(1);
    expect(result.safetySignals[0]).toMatchObject({
      kind: "abnormal-lab",
      severity: "urgent-review",
      sourceRefs: ["boundary-critical-lab"],
    });
    expect(boundaryCase?.unacceptableOutputs.map((output) => output.category)).toEqual(
      expect.arrayContaining([
        "unsupported-diagnosis-from-critical-lab",
        "treatment-recommendation-from-critical-lab",
      ]),
    );
  });

  it("flags overlapping same-ingredient intervals without calling it an interaction", () => {
    const boundaryCase = syntheticBoundaryCases.find(
      (candidate) => candidate.id === "boundary-medication-overlap-v1",
    );
    expect(boundaryCase).toBeDefined();

    const result = evaluateSyntheticBoundaryCase(boundaryCase!);
    expect(result.safetySignals).toHaveLength(1);
    expect(result.safetySignals[0]).toMatchObject({
      kind: "medication-overlap",
      severity: "attention",
    });
    expect(sameRefs(
      result.safetySignals[0].sourceRefs,
      ["boundary-medication-a", "boundary-medication-b"],
    )).toBe(true);
    expect(boundaryCase?.unacceptableOutputs.map((output) => output.category)).toEqual(
      expect.arrayContaining([
        "called-medication-interaction",
        "recommended-stop-or-change",
      ]),
    );
  });
});
