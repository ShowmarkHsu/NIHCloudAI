import { describe, expect, it } from "vitest";

import {
  ClinicalFactSchema,
  ClinicalSummarySchema,
  PatientSnapshotSchema,
  SafetySignalSchema,
  SourceRecordSchema,
  SummaryItemSchema,
  SummaryProvenanceSchema,
  syntheticClinicalFacts,
  syntheticClinicalSummary,
  syntheticPatientSnapshot,
  syntheticSafetySignals,
  syntheticSourceRecords,
  validateClinicalSummaryAgainstSnapshot,
} from "../../src/domain";

describe("domain schemas", () => {
  it("accept the complete synthetic patient fixture", () => {
    expect(SourceRecordSchema.array().safeParse(syntheticSourceRecords).success).toBe(true);
    expect(PatientSnapshotSchema.safeParse(syntheticPatientSnapshot).success).toBe(true);
    expect(ClinicalFactSchema.array().safeParse(syntheticClinicalFacts).success).toBe(true);
    expect(SafetySignalSchema.array().safeParse(syntheticSafetySignals).success).toBe(true);
    expect(ClinicalSummarySchema.safeParse(syntheticClinicalSummary).success).toBe(true);
    expect(SummaryProvenanceSchema.safeParse(syntheticClinicalSummary.provenance).success).toBe(true);
    expect(() =>
      validateClinicalSummaryAgainstSnapshot(
        syntheticClinicalSummary,
        syntheticPatientSnapshot,
      ),
    ).not.toThrow();
  });

  it("rejects a summary item that references an unknown source", () => {
    const summary = {
      ...syntheticClinicalSummary,
      items: syntheticClinicalSummary.items.map((item, index) =>
        index === 0 ? { ...item, sourceRefs: ["src-does-not-exist"] } : item,
      ),
    };

    expect(() =>
      validateClinicalSummaryAgainstSnapshot(summary, syntheticPatientSnapshot),
    ).toThrow(/does not exist in patient snapshot/);
  });

  it("rejects internal source and rule identifiers in visible summary text", () => {
    const sourceIdInText = {
      ...syntheticClinicalSummary,
      items: syntheticClinicalSummary.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              text: `近期有一筆合成用藥紀錄（${syntheticPatientSnapshot.records[0].id}）。`,
            }
          : item,
      ),
    };
    expect(() =>
      validateClinicalSummaryAgainstSnapshot(
        sourceIdInText,
        syntheticPatientSnapshot,
      ),
    ).toThrow(/internal identifier/);

    const ruleIdInText = {
      ...syntheticClinicalSummary,
      items: syntheticClinicalSummary.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              text: `近期有一筆規則整理結果（${syntheticClinicalFacts[0].id}）。`,
            }
          : item,
      ),
    };
    expect(() =>
      validateClinicalSummaryAgainstSnapshot(
        ruleIdInText,
        syntheticPatientSnapshot,
      ),
    ).toThrow(/internal identifier/);
  });

  it("requires non-empty source references on every summary item", () => {
    const itemWithoutRefs = {
      ...syntheticClinicalSummary.items[0],
      sourceRefs: [],
    };
    expect(SummaryItemSchema.safeParse(itemWithoutRefs).success).toBe(false);
  });

  it("rejects unknown fields instead of silently accepting them", () => {
    expect(
      SourceRecordSchema.safeParse({
        ...syntheticSourceRecords[0],
        unexpectedField: "not part of the contract",
      }).success,
    ).toBe(false);
    expect(
      ClinicalSummarySchema.safeParse({
        ...syntheticClinicalSummary,
        unexpectedField: true,
      }).success,
    ).toBe(false);
  });

  it("requires complete strict summary provenance", () => {
    const { provenance: _provenance, ...withoutProvenance } = syntheticClinicalSummary;
    expect(ClinicalSummarySchema.safeParse(withoutProvenance).success).toBe(false);
    expect(
      SummaryProvenanceSchema.safeParse({
        ...syntheticClinicalSummary.provenance,
        promptVersion: "",
      }).success,
    ).toBe(false);
    expect(
      SummaryProvenanceSchema.safeParse({
        ...syntheticClinicalSummary.provenance,
        patientId: syntheticPatientSnapshot.patientId,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid sections and importance values", () => {
    const item = syntheticClinicalSummary.items[0];
    expect(SummaryItemSchema.safeParse({ ...item, section: "not-a-section" }).success).toBe(
      false,
    );
    expect(SummaryItemSchema.safeParse({ ...item, importance: "diagnosis" }).success).toBe(
      false,
    );
  });

  it("rejects source records from another patient or session", () => {
    const mismatchedPatientRecord = {
      ...syntheticSourceRecords[0],
      patientId: "patient-fictional-002",
    };
    const mismatchedPatientSnapshot = {
      ...syntheticPatientSnapshot,
      records: [mismatchedPatientRecord, ...syntheticSourceRecords.slice(1)],
    };
    expect(PatientSnapshotSchema.safeParse(mismatchedPatientSnapshot).success).toBe(false);

    const mismatchedSessionRecord = {
      ...syntheticSourceRecords[0],
      sessionId: "session-fictional-other",
    };
    const mismatchedSessionSnapshot = {
      ...syntheticPatientSnapshot,
      records: [mismatchedSessionRecord, ...syntheticSourceRecords.slice(1)],
    };
    expect(PatientSnapshotSchema.safeParse(mismatchedSessionSnapshot).success).toBe(false);
  });

  it("rejects summaries that belong to another patient or session", () => {
    const mismatchedPatientSummary = {
      ...syntheticClinicalSummary,
      patientId: "patient-fictional-002",
    };
    expect(() =>
      validateClinicalSummaryAgainstSnapshot(
        mismatchedPatientSummary,
        syntheticPatientSnapshot,
      ),
    ).toThrow(/patientId does not match/);

    const mismatchedSessionSummary = {
      ...syntheticClinicalSummary,
      sessionId: "session-fictional-other",
    };
    expect(() =>
      validateClinicalSummaryAgainstSnapshot(
        mismatchedSessionSummary,
        syntheticPatientSnapshot,
      ),
    ).toThrow(/sessionId does not match/);
  });

  it("rejects facts and safety signals that cite records outside the snapshot", () => {
    const summary = {
      ...syntheticClinicalSummary,
      facts: [{ ...syntheticClinicalFacts[0], sourceRefs: ["src-missing"] }],
      safetySignals: [
        { ...syntheticSafetySignals[0], sourceRefs: ["src-missing-signal"] },
      ],
    };
    expect(() =>
      validateClinicalSummaryAgainstSnapshot(summary, syntheticPatientSnapshot),
    ).toThrow(/does not exist in patient snapshot/);
  });

  it("rejects a summary that omits a deterministic safety signal", () => {
    const summary = {
      ...syntheticClinicalSummary,
      items: syntheticClinicalSummary.items.filter((item) => item.section !== "lab"),
    };

    expect(() =>
      validateClinicalSummaryAgainstSnapshot(summary, syntheticPatientSnapshot),
    ).toThrow(/safety signal is not covered by a summary item/);
  });

  it("rejects a summary that downgrades an urgent-review safety signal", () => {
    const summary = {
      ...syntheticClinicalSummary,
      safetySignals: syntheticSafetySignals.map((signal) => ({
        ...signal,
        severity: "urgent-review" as const,
      })),
    };

    expect(() =>
      validateClinicalSummaryAgainstSnapshot(summary, syntheticPatientSnapshot),
    ).toThrow(/summary item lowers the safety signal importance/);
  });
});
