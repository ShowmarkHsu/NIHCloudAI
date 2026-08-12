import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClinicalRulePanel } from "../../src/ui/ClinicalRulePanel";

afterEach(cleanup);

describe("ClinicalRulePanel", () => {
  it("shows deterministic signals separately from AI and exposes their sources", async () => {
    render(
      <ClinicalRulePanel
        messaging={{
          getResults: async () => ({
            ok: true,
            state: {
              kind: "ready",
              result: {
                evaluatedAt: "2026-08-11T03:00:00.000Z",
                facts: [
                  {
                    id: "fact-1",
                    type: "trend",
                    text: "合成檢驗數值由 142 上升至 168 mg/dL。",
                    sourceRefs: ["source-1", "source-2"],
                    derived: true,
                  },
                ],
                safetySignals: [
                  {
                    id: "signal-1",
                    kind: "abnormal-lab",
                    text: "來源具有明示異常標記，請核對原始檢驗紀錄。",
                    sourceRefs: ["source-1"],
                    severity: "attention",
                  },
                ],
                sources: [
                  {
                    id: "source-1",
                    type: "lab",
                    recordedAt: "2026-08-10T00:00:00.000Z",
                    summary: "合成檢驗來源。",
                  },
                ],
              },
            },
          }),
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("明示異常檢驗")).toBeTruthy());
    expect(screen.getByText("非 AI 判斷")).toBeTruthy();
    expect(screen.queryByText("AI 整理文字")).toBeNull();
    expect(screen.getByText(/查看規則來源/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("patientId");
  });

  it("remains usable without a snapshot or provider", async () => {
    render(
      <ClinicalRulePanel
        messaging={{
          getResults: async () => ({ ok: true, state: { kind: "unavailable" } }),
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText(/請先在健保雲端/)).toBeTruthy());
  });
});
