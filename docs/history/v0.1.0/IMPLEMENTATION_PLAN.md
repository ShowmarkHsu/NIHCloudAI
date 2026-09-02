# NICloudAI 實作計畫

每一階段都建立可獨立驗證的垂直切片，先使用合成資料，最後才連接實際健保雲端頁面。

目前已完成專案骨架、確定性規則、兩種 Provider adapter、無病歷連線測試、session-only BYOK、摘要協調流程、健保雲端薄型 adapter、合成 golden tests、`clinical-rules.v2` 與四個合成邊界案例的醫師／藥師重新認證，以及使用本機 Ollama `gemma4:e2b-it-qat` 的 Chrome MV3 合成 smoke。第一個遠端 API 已定為 OpenRouter，模型固定為 `openai/gpt-oss-120b`；合法授權健保頁面與 OpenRouter 的完整人工驗證已於 2026-08-12 由操作者回報通過。

## 1. 專案骨架與合成資料

- 建立 Manifest V3、React、TypeScript 與測試環境。
- 定義來源紀錄、病人快照、臨床事實、摘要輸出的 schema。
- 建立不含真實病人資訊的合成 fixtures。
- 完成病人切換與資料工作階段清除測試。

## 2. 確定性資料處理

- 建立各資料類型 adapter，先以 fixtures 驗證。
- 計算時間範圍、異常值、趨勢及用藥時間重疊。
- 每個計算結果保留來源引用。
- 建立純規則摘要畫面，確認沒有 LLM 時仍可使用。

## 3. 本機 Ollama

- 實作 Provider 介面、timeout、取消與健康檢查。
- 使用結構化輸出並驗證來源引用。
- 建立模型失敗、格式錯誤、逾時與服務未啟動的 UI 狀態。
- 以固定 fixtures 建立 golden tests。

## 4. OpenRouter BYOK Provider

- 建立設定頁、session-only secret vault 與清除功能。
- 只由 background service worker 執行 Provider 請求。
- 固定 OpenRouter endpoint，加入 optional host permission 與輸出遮罩。
- 加入不含病歷的連線測試與第一次外送提醒。

## 5. 健保雲端整合

- 以參考專案與合法測試操作確認端點及資料格式。
- 建立薄的健保資料擷取 adapter，避免 UI 和 LLM 依賴原始格式。
- 驗證登入、授權過期、部分權限、無資料及病人切換情境。
- 僅在本機人工測試中使用真實授權資料，不建立真實資料 fixture。

2026-08-12 已完成合法環境的 origin、頁面範圍、五個資料子集、正規化病人快照、來源回查及授權生命週期驗證；紀錄不保存病人資料或原始 API 回應。

## 6. 臨床驗證與發布準備

- 已建立合成案例的必要驗收主張、量化門檻與不可接受輸出清單，並於 2026-08-12 完成醫師與藥師簽核。
- 已建立缺漏欄位、矛盾來源、明示危急標記與用藥區間重疊的合成邊界案例與規則驗證；`clinical-rules.v2` 與四個案例已於 2026-08-12 完成醫師與藥師逐案重新認證。
- 已在摘要生成脈絡記錄 Provider、模型、prompt、schema 與規則版本，並在 popup 提供安全版本投影。
- 已完成 OpenRouter `openai/gpt-oss-120b` 的開發人員模式端對端人工驗證；見[OpenRouter 端對端驗證紀錄](./OPENROUTER_E2E_VALIDATION.md)。
- 已執行權限、資料外送、secret、log 與建置產物檢查。
- 已決定第一版僅以 Chrome 開發人員模式散布，並完成安裝、手動更新、移除、權限、隱私邊界與已知限制說明；見[開發人員模式散布與安裝指南](./DEVELOPER_MODE_DISTRIBUTION.md)。
