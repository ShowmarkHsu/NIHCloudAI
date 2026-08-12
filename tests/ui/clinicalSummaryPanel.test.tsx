import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClinicalSummaryPanel } from "../../src/ui/ClinicalSummaryPanel";
import type { ClinicalSummaryMessaging } from "../../src/ui/clinicalSummaryMessaging";
import { createClinicalSummaryProvenance } from "../../src/summary";

afterEach(cleanup);

const readySummary = {
  generatedAt: "2026-08-11T02:00:00.000Z",
  provenance: createClinicalSummaryProvenance({
    providerId: "fake",
    model: "fake-model",
  }),
  items: [
    {
      id: "item-1",
      section: "lab" as const,
      text: "近期有一筆合成檢驗紀錄。",
      sourceRefs: ["source-1"],
      importance: "attention" as const,
    },
  ],
  sources: [
    {
      id: "source-1",
      type: "lab" as const,
      recordedAt: "2026-08-10T00:00:00.000Z",
      summary: "合成檢驗來源。",
    },
  ],
};

describe("ClinicalSummaryPanel", () => {
  it("generates a local summary and renders its source without patient identity", async () => {
    const send = vi.fn<ClinicalSummaryMessaging["send"]>(async (message) =>
      message.type === "GET_CLINICAL_SUMMARY"
        ? { ok: true, state: { kind: "idle" } }
        : { ok: true, state: { kind: "ready", summary: readySummary } },
    );
    const messaging: ClinicalSummaryMessaging = {
      send,
      requestRemotePermission: vi.fn(async () => true),
    };

    render(<ClinicalSummaryPanel provider="ollama" model="fake-model" messaging={messaging} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "產生摘要" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "產生摘要" }));

    await waitFor(() => expect(screen.getByText("近期有一筆合成檢驗紀錄。")).toBeTruthy());
    fireEvent.click(screen.getByText("摘要版本"));
    expect(screen.getByText("Prompt：clinical-summary-prompt.v1")).toBeTruthy();
    expect(screen.getByText("Schema：clinical-summary.v1")).toBeTruthy();
    expect(screen.getByText("規則：clinical-rules.v2")).toBeTruthy();
    fireEvent.click(screen.getByText(/查看來源/));
    expect(screen.getByText("合成檢驗來源。")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({
      type: "GENERATE_CLINICAL_SUMMARY",
      providerId: "ollama",
      model: "fake-model",
      remoteDataConsent: undefined,
    });
    expect(document.body.textContent).not.toContain("patientId");
  });

  it("does not send a remote summary when optional host permission is denied", async () => {
    const send = vi.fn<ClinicalSummaryMessaging["send"]>(async () => ({
      ok: true,
      state: { kind: "idle" },
    }));
    const messaging: ClinicalSummaryMessaging = {
      send,
      requestRemotePermission: vi.fn(async () => false),
    };
    render(
      <ClinicalSummaryPanel
        provider="openrouter"
        model="openai/gpt-oss-120b"
        messaging={messaging}
      />,
    );
    await waitFor(() => expect(screen.getByText(/我了解標準化病歷快照/)).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "產生摘要" }));

    await waitFor(() => expect(screen.getByText(/未取得遠端 Provider 網域權限/)).toBeTruthy());
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "GENERATE_CLINICAL_SUMMARY" }),
    );
  });
});
