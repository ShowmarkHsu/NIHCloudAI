import { useEffect, useState } from "react";
import type { PatientSnapshotStatus } from "../shared/patientSnapshotMessages";
import {
  chromePatientSnapshotStatusMessaging,
  type PatientSnapshotStatusMessaging,
} from "./patientSnapshotMessaging";

type PatientSnapshotStatusCardProps = Readonly<{
  messaging?: PatientSnapshotStatusMessaging;
}>;

type LoadState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "loaded"; status: PatientSnapshotStatus }>
  | Readonly<{ kind: "error" }>;

export function PatientSnapshotStatusCard({
  messaging = chromePatientSnapshotStatusMessaging,
}: PatientSnapshotStatusCardProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void messaging
      .getStatus()
      .then((response) => {
        if (cancelled) return;
        if (!response?.ok) {
          setState({ kind: "error" });
          return;
        }
        setState({ kind: "loaded", status: response.status });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [messaging]);

  const available = state.kind === "loaded" && state.status.available;
  const recordCount =
    available && state.status.recordCounts
      ? Object.values(state.status.recordCounts).reduce(
          (total, count) => total + (count ?? 0),
          0,
        )
      : 0;

  const value =
    state.kind === "loading"
      ? "查詢中…"
      : state.kind === "error"
        ? "無法取得狀態"
        : available
          ? `${recordCount} 筆紀錄`
          : "尚未擷取";

  const detail =
    state.kind === "error"
      ? "請重新開啟擴充功能或確認健保雲端頁面。"
      : available
        ? `擷取時間 ${state.status.capturedAt ?? "未知"}；${state.status.warningCount ?? 0} 項資料警示。`
        : "請先在健保雲端開啟已授權的病人頁面。";

  return (
    <article className="status-card">
      <div className="status-card__heading">
        <span
          className={`status-dot status-dot--${available ? "ready" : "waiting"}`}
          aria-hidden="true"
        />
        <h3>病人資料</h3>
        <span
          className={`status-badge status-badge--${available ? "ready" : "waiting"}`}
        >
          {available ? "已擷取" : "等待操作"}
        </span>
      </div>
      <p className="status-card__value">{value}</p>
      <p className="status-card__detail">{detail}</p>
    </article>
  );
}
