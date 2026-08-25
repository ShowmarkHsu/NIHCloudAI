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

1. R2/R3 的程式與合成測試已接上；受控 coverage-only synthetic OpenRouter 已完成 fresh-session 重複性、review/copy、取消及 scope 失效觀察，另有一筆真實 fixed-route `has-data` synthetic facts bounded 成功。固定本機 Ollama coverage-only CLI seam 已連續兩次完成，built-extension UI generation／完整 validator／review-copy gating 重測亦通過；但 `has-data` Ollama 仍被完整語意 validator 拒絕。臨床與藥事已核准 deterministic coverage wording，但 `has-data` 重複性、整體臨床品質與 release acceptance 仍未完成。
2. revision-wide collector 已接上現行產品可提供的西藥、中藥、過敏、檢驗、影像、手術／處置與出院終態結果；就醫仍缺少獨立、結構化 upstream source，不能把 HTML `patientsummary` 或用藥列臆造成 encounter。
3. actual extension browser test 證明已載入 iframe 會 fail closed、可完成 loopback Provider round trip，且 MV3 service worker 重啟後只恢復同 tab 的目前 sealed scope 供 review；真實 Provider 與 NHI-origin 流程仍只可在受控人工環境驗證。
4. `package.json` 使用 upstream 版本號，但文件又宣稱 NIHCloudAI 採獨立 SemVer；release identity 尚未定案。
5. 現有 B6 文件容易讓人誤認已達 release readiness；它只能稱為 engineering gate。
8. 正式 visual run 為 45 passed、1 個窄 tab strip 條件式 expected skip，且沒有 golden 更新。先前 Playwright 在 Windows teardown 卡住，是 managed Vite child process 關閉依賴受限的 `taskkill /T /F`；visual runner 現在自行擁有 server lifecycle 並可乾淨結束。窄螢幕 tab header baseline 已在確認 append-only AI tab 是刻意且可鍵盤到達的最後頁籤後重錄；CKM overview 與 Advanced editor golden 未更新，日後仍不得以任意更新 golden 掩蓋回歸。

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

## 已完成的 R1 checkpoint（2026-08-21）

R1 已完成「檢驗來源的一條無 LLM 垂直切片」：既有 terminal `labdata`
結果只會進入一個 closed module；該 module 內部完成白名單 normalization、
整個家族 quarantine、明確 coverage、revision 專屬 alias/reference vault 及 seal。
sealed snapshot 由 background in-memory store 接受，既有 AI tab 僅顯示 coverage
與 opaque source aliases。其餘 Phase 1 source family 使用明確的
`not-collected`，不再把未收集誤稱 empty 或 negative。合成 integration/browser
測試涵蓋正常、quarantine、revision 與 background acceptance；沒有 LLM、PHI
或 real Provider request。

## 已完成的 R2/R3 local checkpoint（2026-08-21）

已採用 extension-origin iframe。content tab 只將 opaque session/revision 與固定 iframe URL
交給頁面；iframe 以精確 sender URL 向 background 讀取 coverage／本地 labels，並只以
sealed snapshot 建立固定 Ollama 或 OpenRouter request。content script 不持有 Provider
secret、endpoint、model、prompt 或 raw Provider object。OpenRouter 的 BYOK 和 consent
只在 iframe-to-background 的目前 tab/session/revision 範圍記憶體中存在；optional host
permission、固定 route、取消與 revision/patient invalidation 都在 background boundary。

合成 integration test 會驗證 iframe 不收到 sourceRef/patient id、source alias round-trip、
exact iframe sender、session-only BYOK/consent 與舊 revision rejection。`npm run test:extension`
實際載入 build 後的 MV3 iframe，驗證未 seal scope 被 fail closed，並在隔離的暫存
artifact 內以 loopback 合成 Provider 驗證 background transport、完整回應驗證及 service
worker 重啟後的同 tab review recovery。該測試不連線實際 OpenRouter，也不是臨床資料流
驗證；受控人工 coverage-only fixed-route generate/review/copy 已通過，另有一筆
`has-data` synthetic facts bounded 成功，但 repeatability 與臨床品質仍需要獲授權的
本機／院內環境及 reviewer。

2026-08-24 的受控合成 OpenRouter 重試已越過 transport 與 HTTP 階段，但停在本機完整
格式閘門。為避免接觸或保存 Provider 回應內容，background 現在只回報 bounded
fail-closed 類別（缺少輸出、截斷、JSON 結構、來源代號、內容政策或中文字數）。後續重試
已定位到內容政策層，因此再以固定代碼細分為禁止的內部標記／格式、把缺資料寫成陰性、
資料缺口固定措辭及單節欄位長度；人工重試只可回報這些無敏感資料類別，尚不得視為
Provider 成功或解除 release gate。

下一次分類已確認 Provider 把缺少資料寫成陰性結果。根因是 OpenRouter request 將政策與
facts 合併為單一 user message，且 coverage mapping 不具可機讀優先級；不是本機閘門
誤判的證據。因此 `clinical-summary-prompt.v2` 將固定政策提升為 system message，sealed
coverage／facts 留在獨立 user message，並加入封閉的 status-to-wording mapping 與相同的
structured-output description。本機陰性詞閘門沒有放寬；仍需受控人工 round trip 證明
固定 DeepInfra route 的實際模型遵循新契約。

prompt v2 的受控重試仍停在陰性措辭閘門。由於既有 predicate 同時涵蓋「未發現」、
「正常」及除固定「無可用資料」外的任何「無」，目前證據還不能區分模型產生陰性臨床
結論或只是使用「無法確認」一類非固定 gap 措辭。下一輪只回報上述固定詞類，不回傳
句子、章節位置或任何 Provider payload；在詞類確認前不得放寬 validator。

後續固定詞類已確認為非 canonical 的「無」字措辭；prompt v2 仍無法使固定模型／route
穩定遵循，因此已取得明確授權改採 deterministic local coverage renderer。新的
`clinical-summary-prompt.v3` 將 Provider 任務限縮為只摘要 `has-data` facts；完全沒有
collected facts 的 section 與【資料缺口與待確認】一律由 background 依 sealed coverage
產生固定文字並清空該節 Provider aliases。有 facts 的 section 仍保留 Provider prose 並
通過原有完整 validator；沒有放寬陰性詞、metadata、alias、順序、欄位或 180–260 字規則。
這項臨床內容組裝變更已於 2026-08-24 由臨床與藥事 reviewer 依五個合成案例與六個
reviewer 問題重新核准。該核准只涵蓋 deterministic coverage wording；在 `has-data`
repeatability、整體臨床驗收與 release owner 決策補齊前仍不得解除 release gate。

2026-08-24，授權操作者在重新載入 prompt v3／local renderer build 後，以 coverage-only
empty synthetic lab case 完成 fixed-route generation 的 fresh-session 重複觀察。固定格式、
deterministic coverage 語意、review 前後 copy gating、取消、revision、合成病人切換、登出
與 tab 關閉均回報 bounded PASS。首次 review 曾因 MV3 service worker 重啟遺失 background
memory scope 而 fail closed；`983313a` 加入只限同 tab／目前 scope 的 sealed snapshot recovery
後，人工 review/copy 重測與 built-extension restart regression 均通過。

本 repository 未收集摘要、request／response、key、payload、HAR、log、screenshot、clipboard
內容或 session 識別。前述 coverage-only 人工案例沒有 collected facts，因此單獨不能作為
真實 fixed-route `has-data` facts 路徑、臨床品質或措辭核准的證據。使用者另回報資安／
隱私責任者與院方／環境
所有者均已核准；臨床與藥事 reviewer 亦回報 deterministic coverage wording 的五個案例
全數 pass、六個問題全數核准及最終核准。Repository 未收集核准者 identity、簽核參照或
受控系統連結。整體臨床 acceptance 仍待完成。

同日，操作者先確認另一個非空合成 lab scope 為 `has-data`、record count 大於零、只顯示
opaque local source alias，且沒有 identity、raw source ref 或 raw row，再明確授權一次固定
OpenRouter／`openai/gpt-oss-120b`／DeepInfra no-fallback request。操作者只回報 bounded PASS：
完整 validator、至少一項 collected synthetic fact、alias-only attribution、沒有新增未收集事實／
診斷／陰性推論、其他家族的 deterministic coverage 語意，以及 review 前後 copy gating。
未收集任何摘要或 Provider 內容；這是一筆成功觀察，不是 `has-data` repeatability 或臨床驗收。

2026-08-24 的 release-owner 稽核綁定 source commit `6e29265`。離線乾淨 `npm ci`、完整
`npm run verify`、45 passed／1 expected skip 的正式 visual run、23 個 `dist` artifact
連續 build byte-identical，以及 baseline／license／permission／secret／source-map gates 均
通過。但目前沒有 NIHCloudAI release identity、獨立 SemVer、annotated tag、immutable ZIP、
實體 release manifest 或完整 evidence hashes；`has-data` repeatability、整體 clinical
acceptance、真實 Ollama 與 developer-mode install/update/removal record 亦未完成。Release
owner 因此決定 artifact 拒絕、provenance 待補、正式發布拒絕，只允許持續受控開發驗證。
這不是部署、臨床使用、永久外送或 push 授權。

2026-08-25，經明確授權的固定本機 Ollama CLI seam 先以 coverage-only 合成案例重現
`validation-structure-failed`。根因是 Ollama request 未帶既有固定 JSON schema；新增 schema
與固定 `temperature: 0`／`seed: 0` 後，相同真實 loopback boundary 連續兩次通過完整
validator 與 deterministic coverage renderer。測試只記錄 bounded PASS／`completed`，未保存
request、response、摘要、alias、session、log、HAR、screenshot 或 clipboard 內容。另行探索的
`has-data` Ollama 執行雖越過結構驗證，仍被原有陰性措辭、metadata 或欄位 bounds gate
 fail closed，因此不得把 coverage-only 成功延伸為 Ollama `has-data`／`has-data` UI、臨床品質
或 release 驗收。其後操作者重新載入 built extension，回報相同 coverage-only UI generation、固定五段／
完整 validator、review 前 copy disabled 與 review 後 copy enabled 四項全數 PASS；未收集 UI
內容或 screenshot。這項後續證據仍不變更 release owner 已記錄的 artifact 拒絕、provenance
待補與正式發布拒絕。

## 已完成的 Phase 1 collection checkpoint（2026-08-25）

content runtime 不再只挑出 `labdata`。一個 revision-wide deep module 現在接收既有
`dataFetchCompleted` 批次，於同一 interface 內完成來源白名單 normalization、逐家族
quarantine、coverage、opaque aliases、reference vault、revision continuity 與一次性 seal。
現行產品的 `medication`、`chinesemed`、`allergy`、`labdata`、`imaging`、`surgery`、
`discharge` 已映射到七個 Phase 1 家族；R1 lab-only interface 保留為相容 adapter。

上游批次也不再把未授權或 request failure 偽裝成 `nodata`：未授權、抓取失敗、
成功零筆及 normalization failure 會產生不同 coverage。維護中的產品 fixture 證明七個
實際來源形狀均可產生 `has-data`，且 sealed snapshot 不含院所內碼、檔案 handle、影像
case identifier 或藥品內碼。出院索引若只提供出院日與院所，契約以明確 `null` 表示
未提供的入院日、診斷與摘要，不抓取或傳遞 `mds_file`／`mds_pdf_file`。

尚未完成的唯一 Phase 1 收集 seam 是 encounter。現行 `patientsummary` 是 HTML 文字，
不是可驗證的結構化就醫來源；在找到獨立來源前維持 `not-collected`。本 checkpoint 是
本機工程與 fixture 證據，不是 NHI-origin 人工驗證、臨床品質或 release approval。
