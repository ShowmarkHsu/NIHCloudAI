import React, { useEffect, useRef } from "react";
import { Alert, Box, Button, Chip, Divider, Stack, Typography } from "@mui/material";

const EMPTY_VIEW = Object.freeze({
  status: "waiting-for-data",
  generateEnabled: false,
  copyEnabled: false,
  sections: [],
});

const SOURCE_FAMILY_LABELS = Object.freeze({
  encounter: "就醫", "western-medication": "西藥", "chinese-medication": "中藥",
  allergy: "過敏", lab: "檢驗", imaging: "影像", procedure: "處置", discharge: "出院",
});

function coverageCopy(coverage) {
  if (!coverage) return ["尚未建立可核對的檢驗快照。"];
  return Object.entries(SOURCE_FAMILY_LABELS).map(([family, label]) => {
    const state = coverage[family];
    if (!state) return `${label}：未回報`;
    if (state.status === "has-data") return `${label}：${state.recordCount} 筆`;
    if (state.status === "confirmed-empty") return `${label}：已確認無資料`;
    if (state.status === "not-collected") return `${label}：本次未收集`;
    return `${label}：資料缺口（${state.status}）`;
  });
}

function iframeScope(snapshot) {
  if (!snapshot || typeof snapshot.frameUrl !== "string" || snapshot.frameUrl.length === 0) return null;
  if (typeof snapshot.sessionId !== "string" || !Number.isSafeInteger(snapshot.revision) || typeof snapshot.contractVersion !== "string") return null;
  try {
    const url = new URL(snapshot.frameUrl);
    return url.protocol === "chrome-extension:" ? {
      frameUrl: url.href,
      targetOrigin: url.origin,
      sessionId: snapshot.sessionId,
      revision: snapshot.revision,
      contractVersion: snapshot.contractVersion,
    } : null;
  } catch {
    return null;
  }
}

const STATUS_COPY = Object.freeze({
  "waiting-for-data": "尚未建立可用資料工作階段，無法生成摘要。",
  "ready-to-generate": "資料已就緒。請由使用者主動按下「生成摘要」。",
  generating: "正在生成固定五段摘要；可取消目前作業。",
  "ready-for-review": "摘要已生成，請逐段 review 後才可複製。",
  reviewed: "已完成 review，可複製目前版本。",
  "generation-failed": "摘要生成失敗。沒有可複製的摘要，請確認資料狀態後重試。",
  cancelled: "摘要生成已取消。沒有可複製的摘要。",
});

/**
 * Presentation-only view over the closed summary UI flow. It receives no key,
 * patient identity, record, endpoint, or Provider control; callers provide a
 * reviewed flow view and closed user-action callbacks.
 */
export default function AiSummaryTab({
  view = EMPTY_VIEW,
  onGenerate,
  onReview,
  onCopy,
  onCancel,
  sourceRefsForSection,
  labSnapshot,
}) {
  const frame = iframeScope(labSnapshot);
  const frameRef = useRef(null);
  const postScopeToFrame = () => {
    if (!frame || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({
      type: "nihcloudai.ai-frame.scope.v1",
      sessionId: frame.sessionId,
      revision: frame.revision,
      contractVersion: frame.contractVersion,
    }, frame.targetOrigin);
  };
  useEffect(() => {
    postScopeToFrame();
  }, [frame?.frameUrl, frame?.sessionId, frame?.revision, frame?.contractVersion]);
  const sourcesFor = typeof sourceRefsForSection === "function"
    ? sourceRefsForSection
    : () => [];
  const canReview = view.status === "ready-for-review";
  const canCancel = view.status === "generating";

  return (
    <Box sx={{ p: 2 }} data-testid="ai-summary-tab">
      <Stack spacing={1.5}>
        <Typography variant="h6">AI 摘要（需 review）</Typography>
        <Alert severity={view.status === "generation-failed" ? "error" : "info"}>
          {STATUS_COPY[view.status] || STATUS_COPY["waiting-for-data"]}
        </Alert>
        <Box data-testid="ai-lab-snapshot-coverage">
          <Typography variant="subtitle2">檢驗資料快照（未使用 LLM）</Typography>
          <Typography variant="body2">{coverageCopy(labSnapshot?.coverage).join("；")}</Typography>
          {labSnapshot?.sourceAliases?.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" aria-label="檢驗可核對來源">
              {labSnapshot.sourceAliases.map((source) => (
                <Chip key={source.sourceRef} size="small" label={source.label} />
              ))}
            </Stack>
          )}
        </Box>
        {frame ? (
          <iframe
            ref={frameRef}
            title="AI 摘要隔離工作區"
            src={frame.frameUrl}
            onLoad={postScopeToFrame}
            data-testid="ai-summary-extension-frame"
            style={{ border: 0, width: "100%", minHeight: 500 }}
          />
        ) : <>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="contained" onClick={onGenerate} disabled={!view.generateEnabled}>
              生成摘要
            </Button>
            <Button variant="outlined" onClick={onCancel} disabled={!canCancel}>取消</Button>
            <Button variant="outlined" onClick={onReview} disabled={!canReview}>確認 review</Button>
            <Button variant="outlined" onClick={onCopy} disabled={!view.copyEnabled}>複製已 review 摘要</Button>
          </Stack>
          {view.sections.map((section, index) => (
          <React.Fragment key={section.heading}>
            <Divider />
            <Typography variant="subtitle1">{section.heading}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{section.content}</Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" aria-label={`${section.heading} 來源`}>
              {sourcesFor(index).map((sourceRef) => <Chip key={sourceRef} size="small" label={sourceRef} />)}
            </Stack>
          </React.Fragment>
          ))}
        </>}
      </Stack>
    </Box>
  );
}
