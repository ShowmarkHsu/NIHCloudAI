# NIHCloudAI 實作與發布收斂計畫

最後更新：2026-09-02  
目前分支：`codex/canonical-integration-0.2.0`  
文件用途：作為跨 Codex session 的單一執行計畫與進度紀錄。

## 目標與發布邊界

將目前已接通的 NIHCloudAI Chrome Extension 與封閉 AI 摘要流程，收斂為可重現、可審核、具完整非 PHI 證據的受控試用候選版本。

在工程、人工操作、臨床／藥事及 release-owner gate 全部完成前，不得宣稱正式發布、release-ready 或可供一般臨床使用。

## 狀態標記

- `TODO`：尚未開始
- `IN PROGRESS`：本次或後續 session 正在處理
- `BLOCKED`：需要外部權限、人工環境或決策
- `DONE`：已有可驗證證據

## 基線快照

截至 2026-09-02：

- 工程實作估計完成度：85–90%。
- 正式／臨床發布準備估計完成度：60–70%。
- 分支較 `main`：0 behind、109 commits ahead。
- `npm run verify:release`：通過。
- AI tests：141 passed、5 個真實 Ollama cases skipped。
- Browser Mocha：106 passed。
- Extension localhost／iframe integration：通過。
- Visual：45 passed、1 skipped；`settings-accordion-lab` 1440×900 的舊 golden 高度不一致已修正。
- 最新 release builder 已支援 deterministic ZIP、manifest、`SHA256SUMS` 與 reproducible-build gate，但尚未有正式 release-owner inputs 與核准產物。

## 執行計畫

### P0 — 恢復可信的工程與交付基線

| ID | 狀態 | 工作 | 完成條件 |
| --- | --- | --- | --- |
| P0.1 | DONE | 診斷 `settings-accordion-lab` 1px visual regression | 有穩定最小重現、根因、修正；完整 visual suite 通過且不盲目更新 golden |
| P0.2 | DONE | 強化 release CI gate | 使用 `npm ci`，tag/release 前執行 `npm run verify` 與 `npm run test:visual` |
| P0.3 | DONE | 建立跨 session 計畫與進度文件 | 本文件存在，含狀態、證據、下一步與續作規則 |
| P0.4 | IN PROGRESS | 建立 integration branch remote tracking／PR 與 review 策略 | 分支有明確 remote、PR、review 與合併方式；不 force-push/rebase shared history |
| P0.5 | DONE | 清理過時進度敘述 | Recovery/B6/CKM 文件不再把已完成項目列為未完成，且保留歷史稽核邊界 |

### P1 — 定版產品與版本身份

| ID | 狀態 | 工作 | 完成條件 |
| --- | --- | --- | --- |
| P1.1 | DONE | 盤點名稱、SemVer、manifest、package、README 與 tag 規則 | 形成一致方案與修改清單，標出需 owner 決策項目 |
| P1.2 | DONE | 定版 NIHCloudAI 初始 SemVer 與產品名稱 | release owner 明確核准版本與名稱 |
| P1.3 | DONE | 同步產品 metadata | `package.json`、Chrome manifest、README、CHANGELOG、release manifest 一致 |
| P1.4 | DONE | 定義 RC、annotated tag 與 rollback 規則 | 文件化 tag 格式、RC 升版、撤回與回復流程 |

### P2 — 完成受控人工驗證

| ID | 狀態 | 工作 | 完成條件 |
| --- | --- | --- | --- |
| P2.1 | BLOCKED | Developer-mode install/update/remove | 授權操作者依 runbook 完成並留下 bounded、non-PHI evidence |
| P2.2 | BLOCKED | NHI-origin 八類資料與 session lifecycle | 核准測試病人上驗證收集、切病人、revision、登出、關分頁與取消 |
| P2.3 | BLOCKED | Ollama direct-origin／optional permission | 固定模型與環境完成生成、驗證、review/copy、撤權流程 |
| P2.4 | BLOCKED | OpenRouter 固定 route | 記錄 endpoint/model/version，逐 session consent、permission、BYOK 與 no-fallback 行為 |

P2 僅允許保存結果、時間、版本與雜湊等 bounded evidence；不得保存 PHI、API key、request/response body、clipboard、HAR 或病人畫面。

### P3 — 臨床驗收與正式產物核准

| ID | 狀態 | 工作 | 完成條件 |
| --- | --- | --- | --- |
| P3.1 | BLOCKED | 整體 synthetic-summary 臨床／藥事驗收 | 當前 prompt/schema/rules/model 組合取得完整 acceptance |
| P3.2 | BLOCKED | 彙整 evidence hashes | 必要 configuration、clinical 與操作證據均有可驗證 SHA-256 |
| P3.3 | BLOCKED | 產生 immutable release candidate | 乾淨 commit 上產生 ZIP、manifest、`SHA256SUMS` 並通過 reproducibility |
| P3.4 | BLOCKED | Release-owner 決策 | Artifact、Provenance、Publication 三項均有正式結果 |

### P4 — 受控試用

| ID | 狀態 | 工作 | 完成條件 |
| --- | --- | --- | --- |
| P4.1 | BLOCKED | 設計與核准 controlled pilot | P0–P3 全數完成，且安全、隱私、院內與臨床角色均核准 |
| P4.2 | BLOCKED | 執行試用與 rollback 演練 | 有範圍、監測、停止條件、事件處理及回復紀錄 |

## 依賴順序

`P0 工程 gate → P1 產品身份 → P2 人工驗證 → P3 臨床與產物核准 → P4 受控試用`

P0 與 P1 的純工程盤點可平行進行；P2 需要授權操作者、核准測試環境與 Provider 帳號；P3.3 必須等版本身份及所需 evidence hashes 固定後才能產生正式候選產物。

## Release owner 決策

2026-09-02 已確認：

1. 既有 standalone annotated tag `v0.1.0` 視為同一產品 lineage；目前整合版從 `0.2.0` 開始，RC 使用 `v0.2.0-rc.N`；既有 tag 不得重用、移動或刪除。
2. Canonical repository 為 `ShowmarkHsu/NIHCloudAI`。
3. 沿用既有 Chrome extension ID；產品 SemVer 與 Chrome 單調遞增 build version 分離，使用 `version_name` 顯示 `NIHCloudAI 0.2.0`。
4. 對外品牌與中文介面正式名稱均使用 `NIHCloudAI`，不另加未核准的中文副標。
5. Release tag 使用 annotated signed tag；僅授權 release owner 可建立正式 tag/release。

可直接採用、不需等待的發布規則：tag 僅從乾淨 `main`、完整 gates 與 evidence 通過後建立；RC 為 prerelease，stable 才是 latest；撤回版本保留 tag/hash 並標為 withdrawn，不移動 tag；程式回退使用 revert 並發布更高 patch 與 Chrome build version。

## 跨 session 續作規則

每次開始工作時：

1. 讀取本文件、`git status --short --branch` 及最近提交。
2. 驗證上一筆 `IN PROGRESS` 的實際狀態，不只依賴文字紀錄。
3. 從「下一個可執行工作」開始；不得越過尚未完成的必要 gate。
4. 保留使用者及其他代理的既有修改，不清除未知變更。

每次結束工作前：

1. 更新工作狀態與完成證據。
2. 在下方新增進度紀錄，包含日期、執行項目、驗證結果、未解風險及下一步。
3. 若為 `BLOCKED`，記錄需要的權限、外部資料或 owner 決策。
4. 確認 `git status`，清楚列出本次新增或修改的檔案。

## 進度紀錄

### 2026-09-02 — 計畫啟動

- 建立本文件，將既有建議轉為 P0–P4 可追蹤工作。
- 啟動 P0.1 visual regression 診斷。
- 啟動 P0.2 release CI gate 強化。
- 啟動 P1.1 產品／版本身份盤點。
- 保留發布邊界：目前只允許受控開發驗證，不宣稱正式或臨床可用。

### 2026-09-02 — P0.2 與 P1.1

- P0.2 完成：`.github/workflows/release.yml` 改用 `npm ci`，安裝 Playwright Chromium，且在 tag/release 前執行 `npm run verify` 與 `npm run test:visual`。
- CI workflow 已通過 YAML parse、gate 順序、lockfile/scripts 存在性與 `git diff --check` 驗證；已知 visual 失敗現在會正確阻擋發布。
- P1.1 完成：確認既有 annotated `v0.1.0` 指向非目前 HEAD 祖先的 standalone baseline，不能重用。
- 建議整合版產品 SemVer 為 `0.2.0`、首個 RC 為 `v0.2.0-rc.1`；是否採用仍待 release owner 決定。
- 找到 release schema 與 runtime 對 extension version 三段／四段接受範圍不一致；正式 RC 前需連同 SemVer prerelease 支援一起修正並加測試。

下一個可執行工作：完成 P0.1；其後執行完整 visual 驗證。P0.4 需要建立 remote/PR 的外部寫入授權；P1.2–P1.4 等待上述 release-owner 決策。

### 2026-09-02 — P0.1 Visual baseline 修復

- 使用單一 Playwright case 建立 11–14 秒的 red-capable loop，連跑三次均穩定重現 760×418 對 760×419。
- 逐像素比較確認 actual 前 418 rows 與舊 1440 golden 完全相同，只多出底部第 419 row；1024 golden 同為 760×419。
- `LabSettings.jsx` 自 golden 建立 commit 起沒有變更；DOM 高度在兩 viewport 均為 417.515625px。已排除產品 CSS、內容、字型／依賴與動畫時序 regression。
- 僅重錄 `settings-accordion-lab-desktop-1440x900.png`，未修改產品 CSS、未放寬 screenshot threshold。
- `npm.cmd run test:visual`：visual CLI 1 passed；Playwright 45 passed、1 skipped，exit code 0。

下一個可執行工作：完成 P0.5 文件收斂。P0.4 保持 blocked，需 owner 指定 canonical remote 並授權建立 remote branch／PR；P1.2–P1.4 等待 release-owner 決策。

### 2026-09-02 — P0.5 文件狀態收斂

- `PROJECT_RECOVERY_PLAN.md` 與 `B6_RELEASE_EVIDENCE.md` 頂部新增 current-status 指引，明確保留歷史稽核內容，並將目前執行狀態導向本文件。
- CKM screening plan 註明舊 checkbox 曾過時；Tasks 1–4 依現有程式、測試及 commits 補登完成。
- Task 5 僅補登本次可重現的 build 與 browser suite；指定 mock fixture 不存在，mock、人工驗證與收尾維持未完成，未用推測補登。
- 驗證：screening formula smoke values 符合預期；build 成功；相關 ESLint 通過；browser Mocha 106 passed；`git diff --check` 通過。

### 本次 session handoff

- 已完成：P0.1、P0.2、P0.3、P0.5、P1.1。
- 外部阻塞：P0.4 需要 canonical remote 決策及建立 remote branch／PR 的授權。
- Owner 決策阻塞：P1.2–P1.4 需要決定產品 lineage、canonical repository、Chrome build version 映射、中文名稱與 tag 簽署／權限。
- 環境阻塞：P2、P3.1、P3.4、P4 需要授權操作者、核准測試環境、Provider 帳號、臨床／藥事及 release-owner 角色。

下一個 session 應先讀取「待 release owner 決策」，取得決策後執行 P1.2–P1.4；若 owner 同時授權外部 Git 寫入，才執行 P0.4。

### 2026-09-02 — Release owner 決策確認

- 核准產品版本 `0.2.0` 與首個候選 tag `v0.2.0-rc.1`。
- 核准 canonical repository `ShowmarkHsu/NIHCloudAI`，並授權準備 integration remote branch／PR。
- 核准產品 SemVer 與 Chrome build version 分離、沿用 extension ID，品牌與中文介面名稱均使用 `NIHCloudAI`。
- 核准 annotated signed tag 與 main-only、clean-tree、all-gates-before-release 規則。
- P1.2 標記完成；啟動 P0.4、P1.3、P1.4。

### 2026-09-02 — P0.4 Canonical history blocker

- 唯讀確認 canonical `nicloudai/main` 指向 standalone `v0.1.0` commit `f48a741`；目前 `codex/integration-recovery` 與它沒有共同祖先。
- Canonical remote 尚無 `codex/integration-recovery` branch；目前 `gh` authentication token 已失效，無法確認 private repository 的既有 PR、ruleset 或 branch protection。
- 禁止直接 push／開一般 PR，避免產生 unrelated-history 的巨型替換或破壞 canonical history。
- 待 owner 選擇：A）建立明確的 unrelated-history bridge merge，完整保留兩邊歷史但接受大型 reconciliation PR；B）從 canonical `main` 建新 integration branch，挑選或重做必要變更，較安全但工作量較大。預設建議 B。
- 在重新完成 `gh auth`、選定 reconciliation 策略及本地變更收斂前，P0.4 維持 `BLOCKED`。

### 2026-09-02 — P1.3／P1.4 產品身份與發布治理

- Package identity 更新為 `nihcloudai@0.2.0`；canonical repository、issues 與 homepage 統一為 `ShowmarkHsu/NIHCloudAI`。
- Chrome manifest 品牌改為 `NIHCloudAI`，build version 以合法且單調遞增的 `26.702.2` 取代含前導零的舊格式，`version_name` 為 `NIHCloudAI 0.2.0`。
- UI、README、CHANGELOG 與 build artifact stem 統一為 NIHCloudAI／`nihcloudai-extension`；舊 alpha/stable release-branch scripts 改為 fail-fast，避免違反 main-only policy。
- Release schema、runtime validator 與 artifact builder 已支援完整 SemVer 2.0 prerelease（包含 `0.2.0-rc.1`）及三／四段 Chrome build version；補上 malformed prerelease、leading zero 與段數 drift 測試。
- 上游 baseline schema 升至 v2，明確將歷史 integration repository、上游 `26.0702.1` provenance 與目前產品 `0.2.0` 身份分離；`baseline:check` 通過。
- 新增 `RELEASE_GOVERNANCE.md`，固定 RC、signed annotated tag、immutable artifact、withdraw/revert/patch rollback 與 evidence gate 規則。
- Release workflow 不再自行建立日期 tag 或一般 ZIP；只接受與輸入版本相符、GitHub signature verification 通過的既有 annotated tag，要求五個 evidence SHA-256，並使用 deterministic builder 產生 ZIP、manifest 與 `SHA256SUMS`。
- Release workflow 已拆成 read-only verify/package job 與受 `release` environment 保護的 write-only draft publish job；驗 tag commit 位於 canonical `main`、stable 與核准 RC 同 commit，拒絕既有 release／asset overwrite，並將第三方 Actions pin 到不可變 commit SHA。
- 完整驗證：`npm.cmd run verify` exit 0；AI 140 passed、5 skipped，typecheck/lint/characterization/build/release-readiness 通過，Browser 106 passed，Extension integration 通過。
- Visual：CLI 1 passed；Playwright 45 passed、1 skipped，exit 0。
- Release builder 新增 source identity fail-closed gate：tag/workflow release version 必須同時等於 `package.json` version 與 Chrome `version_name`；新增 mismatch regression test，immutable artifact suite 8/8 與 typecheck 通過。

### 本次更新後 handoff

- P1.2–P1.4 已完成；目前本地產品身份與發布契約已收斂。
- P0.4 仍 blocked：canonical 與 integration histories unrelated，且 `gh` token 失效。預設建議從 canonical `main` 建新 integration branch，再挑選／重做必要變更。
- P2 仍需要授權操作者、核准環境與 Provider access；P3.2 等待五份外部 evidence hashes，P3.3 必須在 canonical clean commit 上執行，P3.4 等待 release-owner 最終核准。
- 建立 `v0.2.0-rc.1` 前，候選 commit 必須先將 `package.json` 與 `version_name` 切換為 `0.2.0-rc.1`；目前 `0.2.0` 表示目標 stable identity，不可直接被 builder 誤標為 RC。
- Canonical repository 尚須由 owner 設定受保護的 `release` Environment、required reviewer、signed-tag ruleset 與不可變 releases／attestation；設定完成並可驗證前 Publication gate 保持 blocked。

### 2026-09-02 — 獨立 release audit 與 hardening

- 依 Chrome 官方規範發現 `26.0702.2` 的非零段含前導零，不是合法 Web Store version；改採可保持數值順序的合法 `26.702.2`。
- Builder、runtime schema 與 JSON Schema 現在一致驗證 Chrome 1–4 段、每段 0–65535、非零段不得前導零、版本不得全零；測試涵蓋合法四段、前導零、65536、全零與五段拒絕。
- Release workflow 改用 Windows runner，與目前 visual golden 平台一致；移除 Linux `--with-deps` 路徑。
- Workflow 新增 per-tag concurrency、canonical repository/main ancestry、existing release refusal、stable-to-approved-RC same-commit gate。
- Verify/package job 僅 `contents: read` 且 `persist-credentials: false`；draft publish job 才有 `contents: write`，且不 checkout 或執行 repository code。
- `checkout`、`setup-node`、`upload-artifact`、`download-artifact` 與 `action-gh-release` 全部 pin 到查得的不可變 commit；release action 升至受支援的 v3，設定 `overwrite_files: false` 與 unmatched-file failure。
- 最終 `npm.cmd run verify`：AI 141 passed、5 real-Ollama skipped；typecheck、lint、characterization 9/9、build、23-artifact readiness、Browser 106、Extension integration 全通過。
- 最終 `npm.cmd run test:visual`：CLI 1 passed；Playwright 45 passed、1 skipped，exit 0。

剩餘 release blocker：canonical history reconciliation、有效 `gh auth`、受保護 release environment/tag ruleset/immutable releases、可定位且不可變的五份 evidence objects 與 hashes、P2 人工驗證及整體臨床／藥事 acceptance。

### 2026-09-02 — 方案 B：canonical integration migration 啟動

- 重新驗證 GitHub 與本機的 canonical `main` 均為 `f48a741`；目前來源 HEAD 為 `26db24a`，兩者 `merge-base` 不存在，history blocker 與前次 handoff 一致。
- `gh auth status` 確認 `ShowmarkHsu` token 無效；remote branch、PR、environment、ruleset 與 immutable-release 設定仍待重新授權後確認。
- 從 `f48a741` 建立隔離分支 `codex/canonical-integration-0.2.0` 與獨立 worktree；原 `codex/integration-recovery` dirty worktree 未 reset、checkout、clean 或覆寫。
- Commit `d5ca728` 將 canonical v0.1.0 治理、驗收與架構文件原樣保存至 `docs/history/v0.1.0/`，並標明其證據不滿足 v0.2.0 的 P2/P3 gates。
- Commit `f7debf6` 以 `f48a741` 到 upstream-integrated `cad76e5` 的直接 two-tree diff 導入應用基線；未建立 unrelated-history merge parent。Patch SHA-256：`B2C9209795B2F6EA832DD96163C496B26B21CAB8E64B0C1917E2CE7830183236`。
- 基線 `npm run build` 通過。`cad76e5` 本身沒有 lockfile，因此本批不能執行 `npm ci`；lockfile 由後續 integration commits 恢復後再執行 clean-install gate。
- P0.4 改為 `IN PROGRESS`。下一步依原順序分段移植 `cad76e5..26db24a` 的既有 commits，每段執行相應測試；之後再分批套用未提交的 visual、文件、provenance、identity、release contract、builder 與 workflow hardening。

### 2026-09-02 — 方案 B batch 1：provenance／characterization／visual 基線

- 依原順序移植來源 `75b0486..4a06360` 六個 commits；新分支對應範圍為 `866aa46..b534697`，保留每個原始 commit 的作者、訊息與可審查邊界。
- 驗證通過：synthetic fixtures 6/6、non-AI characterization 8/8、Browser Mocha 106 passed、Playwright visual 40 passed。
- `baseline:check` 在本批預期失敗：舊 gate 只接受 `cad76e5` 為 Git ancestor，但方案 B 以可驗證 two-tree patch 導入且刻意不連接 unrelated history。後續 provenance hardening 必須改以固定來源 tree／patch hash 驗證此 migration，並在最終 `npm run verify` 前補回全綠。
- 未建立 tag、artifact 或 release；原 dirty worktree 保持不變。下一批移植 typed boundary、lint、AI contracts 與 release schema。

### 2026-09-02 — 方案 B batch 2：typed boundary／AI contracts

- 依原順序移植來源 `821483c..c5c162a` 五個 commits；新分支對應範圍為 `287250d..0e3162a`。
- 驗證通過：AI 18 passed、TypeScript AI typecheck、B1/AI lint scope 與 lint。
- 下一批移植 projection、session/security、summary state 與 B6 readiness；publication 與 P2/P3 gates 維持 blocked。

### 2026-09-02 — 方案 B batches 3–5：closed AI runtime 與 controlled-validation code

- 依原順序移植來源 `aeec581..6419eea` 七十二個 commits，涵蓋 projection、tab-scoped session/security、fixed summary、runtime/provider/iframe、permission、transport、coverage、phase-one clinical sources 與 extension UI tests。
- 中途 byte-level summary golden 因 Windows 初次 materialization 為 CRLF 而失敗；來源 commit `8857722` 已加入 `eol=lf`，將原工作樹的相同 blob 以 LF 物化並重新索引後，未產生內容差異，相關 formatter test 回復通過。
- 乾淨安裝：移除本次建立的 `node_modules` junction 並確認原工作樹依賴仍存在；隔離 worktree 的 `npm ci` 通過。
- 前半批驗證通過：AI 118 passed、typecheck、lint、characterization 9/9、build、23-artifact readiness、Browser 106、Extension iframe integration、visual CLI 1 與 Playwright 46 passed。
- 後半批驗證通過：AI 125 passed、2 real-Ollama skipped、typecheck、build、23-artifact readiness、Extension iframe integration。
- `baseline:check` 的 ancestry-only 限制仍是已知 migration gate，留待 provenance batch 修正；P2/P3 文件中的舊 bounded observations 不升級為本次正式 acceptance。
- 下一批移植剩餘 summary/provider/release/extension closure 與 immutable builder commits。

### 2026-09-02 — 方案 B batch 6：完成 committed integration history 移植

- 依原順序移植來源 `5a4231a..26db24a` 最後二十六個 commits；累計 109 個 `cad76e5` 之後的既有 commits 全數移植，未建立 unrelated-history merge。
- 排除本 migration 新增的 `docs/history/v0.1.0/` 與本計畫文件後，新分支 tree 與來源 `26db24a` 無差異。
- 驗證通過：AI 138 passed、5 real-Ollama skipped、typecheck、lint、characterization 9/9、build、23-artifact readiness、Browser 106、Extension iframe 與 localhost injection integration、visual CLI 1 與 Playwright 46 passed。
- `baseline:check` 仍只因 ancestry-only 假設 blocked。下一步分批套用原 dirty delta，並在 provenance batch 以 canonical snapshot migration evidence 修正此 gate。

### 2026-09-03 — 方案 B dirty batch A：visual golden

- Commit `9dade0c` 只移植 `settings-accordion-lab-desktop-1440x900.png`，SHA-256 為 `FF5381C3ACC87D7E11015603D534310418F69EE1BB5C87F239002575A3E822A9`。
- 專案 visual runner 的 settings-accordion 單一 case 2/2 通過；完整 visual CLI 1 passed、Playwright 46 passed。
- 直接呼叫 Playwright CLI 曾因未啟動 Vite server 出現 `ERR_CONNECTION_REFUSED`；改用專案自帶且負責 server lifecycle 的 runner 後通過，未修改產品或測試門檻。
- 下一批移植 recovery/B6/CKM 文件 current-status 收斂；P2/P3 與 publication 仍 blocked。

### 2026-09-03 — 方案 B dirty batch B：current-status 文件收斂

- Commit `acbd304` 移植 `B6_RELEASE_EVIDENCE.md`、`PROJECT_RECOVERY_PLAN.md` 與 CKM screening plan 的 current-status 更新；保留原歷史內容並避免把舊 evidence 誤列為 v0.2.0 的 P2/P3 acceptance。
- `git diff --check` 通過，僅有 Windows LF→CRLF 提示；未改動產品程式。
- 下一批處理 upstream provenance schema/checker，並修正方案 B 不具 upstream ancestor 的可驗證 snapshot migration gate。

### 2026-09-03 — 方案 B dirty batch C：canonical snapshot provenance

- Commit `ba3c56a` 將 upstream baseline schema 升至 v3，記錄 canonical base、upstream snapshot/tree、import commit/tree 與 two-tree patch SHA-256。
- `baseline:check` 現在保留原 upstream-ancestor 模式，並增加 canonical-two-tree-patch 模式；本分支驗證 canonical base/import ancestry 與 immutable import tree 後通過。
- Package-coupled focused contract test 已驗證 migration assertions，但因 identity 尚為 `nhitw-cloud-analyzer@26.0702.1` 而預期失敗；該 test 不納入本 commit，留待下一個 `nihcloudai@0.2.0` identity 批次一起轉綠。
- 下一批移植 package/lock、Chrome manifest、品牌 UI、README/CHANGELOG、build 與 test mock identity。

### 2026-09-03 — 方案 B dirty batch D：NIHCloudAI 0.2.0 identity

- Commit `4297bed` 統一 package/lock、canonical URLs、Chrome manifest、build、UI、README/CHANGELOG 與 visual mock：`nihcloudai@0.2.0`、Chrome `26.702.2`、`NIHCloudAI 0.2.0`。
- 隔離 worktree 的 `npm ci` 完成：added 506 packages、0 vulnerabilities。期間一次 partial install 造成 `ENOTEMPTY`；確認無殘留 npm/node process後，重跑同一 clean install 成功。
- 驗證通過：canonical snapshot `baseline:check`、focused identity/provenance contract 2/2、build、Browser 106、visual CLI 1、Playwright 45 passed／1 skipped。
- 下一批移植 release SemVer/Chrome schema 與 runtime contract；仍不建立 RC tag 或 artifact。

### 2026-09-03 — 方案 B dirty batch E：release version contracts

- Commit `ee9ed0f` 對齊 JSON Schema、runtime validator 與 contract tests，支援完整 SemVer prerelease 及合法 Chrome 1–4 段 build version，並拒絕前導零、超界、全零與段數 drift。
- Focused release contract 7/7 與 AI typecheck 通過；`git diff --check` 無錯誤。
- 下一批移植 deterministic builder 的 source-identity fail-closed gate 與 immutable artifact tests；只執行測試內的 temporary artifacts，不建立 RC 或正式 artifact。

### 2026-09-03 — 方案 B dirty batch F：immutable builder hardening

- Commit `9ddb53e` 移植 builder 的 source-identity fail-closed gate：release input/tag version 必須與 package version、Chrome `version_name` 一致。
- Immutable artifact suite 8/8 與 AI typecheck 通過；測試產物僅位於 temporary repos/directories，未建立 RC tag 或正式 release artifact。
- 下一批移植 signed-tag、canonical-main、evidence-hash、protected-environment draft publication workflow 與 fail-fast legacy release scripts。
