import { describe, expect, it } from "vitest";

import {
  syntheticPatientSnapshot,
  type PatientSnapshot,
  type SourceRecord,
} from "../../src/domain";
import { evaluateClinicalRules } from "../../src/rules";

const PATIENT_ID = "patient-rules-fixture";
const SESSION_ID = "session-rules-fixture";

function makeRecord(
  id: string,
  type: SourceRecord["type"],
  data: Record<string, unknown>,
  recordedAt = "2026-01-01T00:00:00Z",
): SourceRecord {
  return {
    id,
    patientId: PATIENT_ID,
    sessionId: SESSION_ID,
    type,
    recordedAt,
    summary: `${type} ${id}`,
    data,
  };
}

function makeSnapshot(records: SourceRecord[]): PatientSnapshot {
  return {
    patientId: PATIENT_ID,
    sessionId: SESSION_ID,
    capturedAt: "2026-01-31T00:00:00Z",
    records,
  };
}

describe("evaluateClinicalRules", () => {
  it("creates source-backed medication and allergy facts without changing the fixture", () => {
    const before = structuredClone(syntheticPatientSnapshot);
    const result = evaluateClinicalRules(syntheticPatientSnapshot);

    expect(result.facts.filter((fact) => fact.type === "medication")).toHaveLength(2);
    expect(result.facts.filter((fact) => fact.type === "allergy")).toHaveLength(1);
    expect(result.facts.every((fact) => fact.patientId === syntheticPatientSnapshot.patientId)).toBe(true);
    expect(result.facts.every((fact) => fact.sessionId === syntheticPatientSnapshot.sessionId)).toBe(true);
    expect(result.facts.every((fact) => fact.sourceRefs.every((ref) =>
      syntheticPatientSnapshot.records.some((record) => record.id === ref),
    ))).toBe(true);
    expect(syntheticPatientSnapshot).toEqual(before);
  });

  it("creates one numeric trend per test name and unit and describes only direction", () => {
    const snapshot = makeSnapshot([
      makeRecord("lab-old", "lab", { testName: "血糖", value: "100", unit: "mg/dL" }, "2026-01-01T00:00:00Z"),
      makeRecord("lab-new", "lab", { testName: "血糖", value: 120, unit: "mg/dL" }, "2026-01-02T00:00:00Z"),
    ]);

    const { facts } = evaluateClinicalRules(snapshot);
    const trend = facts.find((fact) => fact.type === "trend");
    expect(trend).toBeDefined();
    expect(trend?.sourceRefs).toEqual(["lab-old", "lab-new"]);
    expect(trend?.text).toContain("上升");
    expect(trend?.text).not.toMatch(/改善|惡化|診斷|治療/);
  });

  it("does not merge lab values that use different units", () => {
    const snapshot = makeSnapshot([
      makeRecord("lab-mg", "lab", { testName: "Glucose", value: 100, unit: "mg/dL" }, "2026-01-01T00:00:00Z"),
      makeRecord("lab-mmol", "lab", { testName: "Glucose", value: 5.5, unit: "mmol/L" }, "2026-01-02T00:00:00Z"),
    ]);

    expect(evaluateClinicalRules(snapshot).facts.some((fact) => fact.type === "trend")).toBe(false);
  });

  it("creates no abnormal signal for a normal value with a parseable range", () => {
    const snapshot = makeSnapshot([
      makeRecord("lab-normal", "lab", {
        testName: "Creatinine",
        value: "1.0",
        unit: "mg/dL",
        referenceRange: "0.6-1.2",
        interpretation: "normal",
      }),
    ]);

    expect(evaluateClinicalRules(snapshot).safetySignals).toEqual([]);
  });

  it("creates an attention abnormal-lab signal for explicit high and outside-range values", () => {
    const snapshot = makeSnapshot([
      makeRecord("lab-high", "lab", {
        testName: "Glucose",
        value: 168,
        unit: "mg/dL",
        referenceRange: "70-99",
        interpretation: "H",
      }),
    ]);

    const signals = evaluateClinicalRules(snapshot).safetySignals;
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      kind: "abnormal-lab",
      severity: "attention",
      sourceRefs: ["lab-high"],
    });
  });

  it("marks only explicit critical interpretations as urgent review", () => {
    const snapshot = makeSnapshot([
      makeRecord("lab-critical", "lab", {
        testName: "Potassium",
        value: 7,
        unit: "mmol/L",
        interpretation: "C",
      }),
      makeRecord("lab-range-only", "lab", {
        testName: "Sodium",
        value: 150,
        unit: "mmol/L",
        referenceRange: "135-145",
      }),
    ]);

    const signals = evaluateClinicalRules(snapshot).safetySignals;
    expect(signals).toHaveLength(2);
    expect(signals.find((signal) => signal.sourceRefs[0] === "lab-critical")?.severity).toBe("urgent-review");
    expect(signals.find((signal) => signal.sourceRefs[0] === "lab-range-only")?.severity).toBe("attention");
  });

  it("does not infer trends or overlaps when required fields are missing", () => {
    const snapshot = makeSnapshot([
      makeRecord("lab-one", "lab", { testName: "TSH", value: 1.2, unit: "mIU/L" }, "2026-01-01T00:00:00Z"),
      makeRecord("lab-two-no-unit", "lab", { testName: "TSH", value: 1.4 }, "2026-01-02T00:00:00Z"),
      makeRecord("med-one", "medication", { genericName: "same-drug", medicationName: "A" }),
      makeRecord("med-two", "medication", { genericName: "same-drug", medicationName: "B" }),
    ]);

    const result = evaluateClinicalRules(snapshot);
    expect(result.facts.some((fact) => fact.type === "trend")).toBe(false);
    expect(result.safetySignals.some((signal) => signal.kind === "medication-overlap")).toBe(false);
  });

  it("creates a medication-overlap signal only for explicit intersecting intervals", () => {
    const snapshot = makeSnapshot([
      makeRecord("med-a", "medication", {
        genericName: "amoxicillin",
        medicationName: "Product A",
        startDate: "2026-01-01",
        endDate: "2026-01-10",
      }),
      makeRecord("med-b", "medication", {
        genericName: "AMOXICILLIN",
        medicationName: "Product B",
        startDate: "2026-01-10",
        endDate: "2026-01-20",
      }),
      makeRecord("med-c", "medication", {
        genericName: "amoxicillin",
        medicationName: "Product C",
        startDate: "2026-02-01",
        endDate: "2026-02-10",
      }),
    ]);

    const signals = evaluateClinicalRules(snapshot).safetySignals.filter(
      (signal) => signal.kind === "medication-overlap",
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].sourceRefs).toEqual(["med-a", "med-b"]);
  });

  it("uses generic name in preference to medication name and produces deterministic output", () => {
    const snapshot = makeSnapshot([
      makeRecord("med-a", "medication", {
        genericName: "generic-a",
        medicationName: "same-brand",
        date: "2026-01-01",
        daysSupply: 10,
      }),
      makeRecord("med-b", "medication", {
        genericName: "generic-b",
        medicationName: "same-brand",
        date: "2026-01-05",
        daysSupply: 10,
      }),
    ]);

    const first = evaluateClinicalRules(snapshot);
    const second = evaluateClinicalRules(snapshot);
    expect(first).toEqual(second);
    expect(first.safetySignals.some((signal) => signal.kind === "medication-overlap")).toBe(false);
  });

  it("treats daysSupply as an inclusive interval: adjacent courses do not overlap", () => {
    const snapshot = makeSnapshot([
      makeRecord("med-days-a", "medication", {
        genericName: "same-drug",
        date: "2026-01-01",
        daysSupply: 10,
      }),
      makeRecord("med-days-adjacent", "medication", {
        genericName: "same-drug",
        date: "2026-01-11",
        daysSupply: 10,
      }),
      makeRecord("med-days-boundary", "medication", {
        genericName: "same-drug",
        date: "2026-01-10",
        daysSupply: 1,
      }),
    ]);

    const overlapSignals = evaluateClinicalRules(snapshot).safetySignals.filter(
      (signal) => signal.kind === "medication-overlap",
    );
    expect(overlapSignals).toHaveLength(1);
    expect(overlapSignals[0].sourceRefs).toEqual(["med-days-a", "med-days-boundary"]);
  });

  it("parses numeric compact dates before epoch values for date plus daysSupply", () => {
    const snapshot = makeSnapshot([
      makeRecord("med-compact-8", "medication", {
        genericName: "compact-drug",
        date: 20260105,
        daysSupply: 5,
      }),
      makeRecord("med-compact-string", "medication", {
        genericName: "compact-drug",
        date: "2026-01-09",
        daysSupply: 1,
      }),
      makeRecord("med-compact-14", "medication", {
        genericName: "compact-drug",
        date: 20260105000000,
        daysSupply: 1,
      }),
    ]);

    const overlapSignals = evaluateClinicalRules(snapshot).safetySignals.filter(
      (signal) => signal.kind === "medication-overlap",
    );
    expect(overlapSignals).toHaveLength(2);
    expect(overlapSignals.map((signal) => signal.sourceRefs)).toEqual([
      ["med-compact-14", "med-compact-8"],
      ["med-compact-8", "med-compact-string"],
    ]);
  });

  it("emits one deterministic attention contradiction signal for explicit opposite allergy assertions", () => {
    const snapshot = makeSnapshot([
      makeRecord("allergy-positive", "allergy", {
        allergen: "Synthetic antibiotic X",
        assertion: "allergy-present",
        reaction: "fictional rash",
      }, "2026-01-02T00:00:00Z"),
      makeRecord("allergy-negative", "allergy", {
        allergen: " synthetic  ANTIBIOTIC x ",
        assertion: "allergy-absent",
        reaction: "none recorded",
      }, "2026-01-01T00:00:00Z"),
    ]);

    const first = evaluateClinicalRules(snapshot);
    const second = evaluateClinicalRules(snapshot);
    const contradictions = first.safetySignals.filter((signal) => signal.kind === "contradiction");

    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]).toMatchObject({
      kind: "contradiction",
      severity: "attention",
      sourceRefs: ["allergy-negative", "allergy-positive"],
    });
    expect(contradictions[0].text).toMatch(/過敏項目/);
    expect(contradictions[0].text).toMatch(/矛盾/);
    expect(contradictions[0].text).toMatch(/核對/);
    expect(contradictions[0].text).not.toMatch(/確定|選擇|停用|診斷|治療/);
    expect(first).toEqual(second);
  });

  it("does not infer allergy contradiction from missing, unknown, same-direction, or different-allergen assertions", () => {
    const cases: PatientSnapshot[] = [
      makeSnapshot([
        makeRecord("missing-present", "allergy", {
          allergen: "Synthetic antibiotic X",
          assertion: "allergy-present",
        }),
        makeRecord("missing-assertion", "allergy", {
          allergen: "Synthetic antibiotic X",
          reaction: "none recorded",
        }),
      ]),
      makeSnapshot([
        makeRecord("unknown-present", "allergy", {
          allergen: "Synthetic antibiotic X",
          assertion: "allergy-present",
        }),
        makeRecord("unknown-value", "allergy", {
          allergen: "Synthetic antibiotic X",
          assertion: "allergy-unknown",
        }),
      ]),
      makeSnapshot([
        makeRecord("same-present-a", "allergy", {
          allergen: "Synthetic antibiotic X",
          assertion: "allergy-present",
        }),
        makeRecord("same-present-b", "allergy", {
          allergen: "Synthetic antibiotic X",
          assertion: "allergy-present",
        }),
      ]),
      makeSnapshot([
        makeRecord("different-positive", "allergy", {
          allergen: "Synthetic antibiotic X",
          assertion: "allergy-present",
        }),
        makeRecord("different-negative", "allergy", {
          allergen: "Synthetic antibiotic Y",
          assertion: "allergy-absent",
        }),
      ]),
      makeSnapshot([
        makeRecord("reaction-positive", "allergy", {
          allergen: "Synthetic antibiotic X",
          reaction: "allergy-present",
        }),
        makeRecord("reaction-negative", "allergy", {
          allergen: "Synthetic antibiotic X",
          reaction: "allergy-absent",
        }),
      ]),
    ];

    for (const snapshot of cases) {
      expect(evaluateClinicalRules(snapshot).safetySignals.some(
        (signal) => signal.kind === "contradiction",
      )).toBe(false);
    }
  });
});
