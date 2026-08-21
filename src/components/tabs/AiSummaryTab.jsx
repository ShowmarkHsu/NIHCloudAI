import React from "react";
import { Alert, Box, Button, Chip, Divider, Stack, Typography } from "@mui/material";

const EMPTY_VIEW = Object.freeze({
  status: "waiting-for-data",
  generateEnabled: false,
  copyEnabled: false,
  sections: [],
});

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
}) {
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
      </Stack>
    </Box>
  );
}
