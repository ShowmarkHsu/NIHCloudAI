import { describe, expect, it } from "vitest";
import type { ClinicalSummaryView } from "../../src/shared/clinicalSummaryMessages";
import { assertNoInternalIdentifiersInSummary } from "../../src/smoke/summaryAssertions";
import { createClinicalSummaryProvenance } from "../../src/summary";

function summaryWithText(text: string): ClinicalSummaryView {
  return {
    generatedAt: "2026-08-12T00:00:00.000Z",
    provenance: createClinicalSummaryProvenance({
      providerId: "synthetic-provider",
      model: "synthetic-model",
    }),
    items: [
      {
        id: "summary-item-1",
        section: "lab",
        text,
        sourceRefs: ["src-lab-001-smoke-a-1"],
        importance: "attention",
      },
    ],
    sources: [],
  };
}

describe("synthetic smoke summary assertions", () => {
  it("accepts visible summary text without internal identifiers", () => {
    expect(() =>
      assertNoInternalIdentifiersInSummary(
        summaryWithText("空腹血糖由 142 mg/dL 上升至 168 mg/dL。"),
        ["src-lab-001-smoke-a-1", "rule-lab-trend-885962da"],
      ),
    ).not.toThrow();
  });

  it("rejects a dynamic smoke source identifier in visible text", () => {
    expect(() =>
      assertNoInternalIdentifiersInSummary(
        summaryWithText("空腹血糖為 168 mg/dL（src-lab-001-smoke-a-1）。"),
        ["src-lab-001-smoke-a-1"],
      ),
    ).toThrow("Rendered summary contains an internal identifier.");
  });

  it("rejects a deterministic rule identifier in visible text", () => {
    expect(() =>
      assertNoInternalIdentifiersInSummary(
        summaryWithText("空腹血糖呈上升趨勢（rule-lab-trend-885962da）。"),
        ["rule-lab-trend-885962da"],
      ),
    ).toThrow("Rendered summary contains an internal identifier.");
  });
});
