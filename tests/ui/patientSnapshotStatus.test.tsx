import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PatientSnapshotStatusCard } from "../../src/ui/PatientSnapshotStatusCard";

afterEach(cleanup);

describe("PatientSnapshotStatusCard", () => {
  it("shows aggregate counts without exposing patient identity", async () => {
    const messaging = {
      getStatus: async () => ({
        ok: true as const,
        status: {
          available: true,
          sessionId: "opaque-session",
          capturedAt: "2026-08-11T00:00:00.000Z",
          recordCounts: { medication: 2, lab: 3 },
          warningCount: 1,
        },
      }),
    };

    render(<PatientSnapshotStatusCard messaging={messaging} />);

    await waitFor(() => expect(screen.getByText("5 筆紀錄")).toBeTruthy());
    expect(screen.queryByText("opaque-session")).toBeNull();
    expect(screen.getByText(/1 項資料警示/)).toBeTruthy();
  });

  it("shows a safe unavailable state when no snapshot exists", async () => {
    render(
      <PatientSnapshotStatusCard
        messaging={{
          getStatus: async () => ({ ok: true, status: { available: false } }),
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("尚未擷取")).toBeTruthy());
  });
});
