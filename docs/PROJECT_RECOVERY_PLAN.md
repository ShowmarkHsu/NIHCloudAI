# NIHCloudAI 專案復原計畫

狀態日期：2026-08-21  
工作主線：`codex/integration-recovery`  
穩定基準：`main` = `origin/main` = `upstream/main` @ `cad76e5`（26.0702.1）

## 結論

本專案應「停止 standalone 產品路線，保留可驗證成果，沿 upstream fork 收斂續作」。不建議停止專案，也不建議從空白 repository 重寫。

原因：原始 NHITW Cloud Analyzer 的資料處理、非 AI 介面與使用習慣仍是最有價值的產品基底；現有 AI 分支也已建立 closed schema、來源引用、snapshot revision、session lifecycle、review/copy state machine 與 characterization tests。問題不在於完全沒有成果，而在於各 module 尚未透過同一條真實產品流程連接。

目前不具備臨床使用或正式 release 條件。`npm run verify` 通過只代表合成契約、非 AI 回歸、建置與瀏覽器測試通過，不能代表 AI 摘要在擴充功能內可用。

## 目前可保留的成果

- upstream fork、Apache-2.0 授權與三個 remote 的來源追溯。
- 既有 MUI 介面、浮動入口、資料處理器與 106 個瀏覽器測試。
- `src/ai/contracts`、`src/ai/projection`、`src/ai/session` 的封閉資料契約與病人／revision 隔離。
- fixed five-section schema、formatter、review/copy invalidation state machine。
- 非 AI characterization、clipboard golden、兩種 viewport visual baselines。
- 背景執行 Provider、session-only secret 與最小權限的設計方向。

## 目前必須承認的缺口

1. `AiSummaryTab` 在產品中沒有收到 `view` 或操作 callback，因此實際畫面不會進入可生成狀態。
2. 現有 Provider `generate` interface 不接收 sealed snapshot、clinical facts 或 coverage；固定 request 只有指令文字，沒有病歷內容。
3. projection adapters 只在合成測試中執行，尚未接到 upstream processor 的逐筆資料 seam。
4. lifecycle message 已接到 content/background，但 snapshot seal、Provider、UI flow 尚未形成同一條端對端路徑。
5. 規劃要求 extension-origin iframe，現況卻是 content-script React tab；安全模型與實作不一致。
6. `package.json` 使用 upstream 版本號，但文件又宣稱 NIHCloudAI 採獨立 SemVer；release identity 尚未定案。
7. 現有 B6 文件容易讓人誤認已達 release readiness；它只能稱為 engineering gate。
8. 乾淨 dependency install 後，42 個視覺測試有 4 個 baseline 差異（3 個高度／版面差異、1 個窄螢幕 tab strip 像素差）。過去未提交 lockfile，使 React／MUI patch 版本可漂移；在人工判讀前不得更新 golden 掩蓋差異。

## 後續執行順序

### R0 — 誠實基線與 repository 收斂

- 只保留 `main` 與一條短期 `codex/*` 工作分支。
- `main` 對準產品 fork；standalone 歷史只由 tag／`nicloudai` remote 保存。
- 納入 `package-lock.json`，讓 CI 與本機使用相同 dependency graph；保留目前 visual failure 作為待判讀證據，不直接重錄 baseline。
- README、release evidence 與版本說明必須明確區分「工程 gate」與「可用產品」。

完成條件：乾淨 worktree、remote topology 可重現、`npm ci && npm run verify` 通過。

### R1 — 一條沒有 LLM 的真實垂直切片

只選一個來源家族（建議檢驗）完成：upstream raw record → clinical projection → sealed snapshot → background store → AI tab 顯示來源與 coverage。先不用 Provider，也不產生臨床文字。

在這個 seam 上建立一個 deep module：caller 只提供來源終止結果與 session scope；module 內部負責正規化、quarantine、coverage、revision 與 seal。測試只跨這個 interface 驗證結果，不再各測一串彼此未連接的 shallow modules。

完成條件：合法的合成檢驗資料能從 content runtime 到 AI tab 顯示；病人切換、tab 關閉、revision 更新都會使舊資料失效；非 AI 畫面 golden 不變。

### R2 — 接上本機 Ollama 的可核對摘要

- Provider interface 接受最小化且已 seal 的 summary request，不接受 raw object、DOM、URL、模型名或任意 prompt。
- 先只提供固定 Ollama endpoint／模型；完成 timeout、cancel、strict output validation、source alias round-trip。
- AI tab 實作唯讀來源摘要、可編輯草稿、任何修改後 review 失效，以及 review 後才可複製。
- 對整條流程寫一個 browser integration test，而非只測各自 state machine。

完成條件：合成資料可在實際 extension build 中完成生成、驗證、核對與複製；任何錯誤不得顯示 partial draft。

### R3 — OpenRouter 與遠端資料治理

只有 R2 穩定後才加入 OpenRouter。完成 optional permission、session-only BYOK、逐 session 外送同意、固定模型／route、no fallback、request allow-list 與 route provenance。真實病人資料不得用於自動測試或進入 repository。

完成條件：遠端 request deep-equal 測試、secret scan、permission lifecycle、取消與病人切換測試全部通過；再由授權操作者執行不保存 PHI 的人工驗證。

### R4 — 受控試用，而不是一般 release

雙 Provider、固定 artifact、prompt/schema/rules/model manifest、臨床角色簽核、靜默驗證、暫停與 rollback 條件全部具備後，才可討論受控院內試用。未完成前不得宣稱「可臨床使用」。

## 何時應停止或重開

只有下列任一條成立時才停止並重開 repository：

- upstream 授權、存取或維護關係失效，無法再合法作為產品基底；
- 無法在不暴露 raw payload／病人 identity 的前提下建立 clinical projection seam；
- R1 垂直切片必須大幅重寫所有 upstream processor，且 characterization 無法保住非 AI 行為；
- 院方治理明確禁止目前的瀏覽器擴充功能或 Provider 模式。

在這些條件出現前，重寫只會丟掉已驗證的非 AI 行為與安全契約，並增加重新驗收成本。

## 下一個 coding session 的唯一目標

執行 R1，只做「檢驗來源的一條無 LLM 垂直切片」。不要同時實作 Ollama、OpenRouter、更多來源家族或發布流程。完成後再依同一 deep module interface 擴張其他來源。
