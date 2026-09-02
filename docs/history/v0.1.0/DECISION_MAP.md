# NICloudAI 決策地圖

本文件追蹤在進入完整實作規格前必須釐清的產品與技術決策。已決定的項目應反映在 ADR 或 MVP 規格；尚未決定的項目不得被程式碼默默定案。

## 已決定

### D1：第一版產品邊界

- 第一版是「附來源的病歷摘要與資訊導航」。
- 不提供診斷、疾病機率、治療方案或處方建議。
- 數值異常、時間範圍、重複用藥與趨勢由確定性規則計算；LLM 只負責整理和表達。

### D2：LLM 執行位置

- 預設提供本機 Ollama。
- 開發階段另提供 BYOK 的遠端 API Provider。
- 目前不實作院內 Gateway。

### D3：API Key 生命周期

- API Key 只能由擴充功能設定畫面輸入。
- 只保存在當次 extension session，瀏覽器重啟、擴充功能更新或重新載入後清除。
- API Key 不得進入原始碼、環境變數、Git、建置產物、測試快照、log 或錯誤回報。

### D4：AI 輸入與輸出邊界

- LLM 只接收正規化後的病人快照，不直接讀 DOM 或健保 API 原始回應。
- LLM 必須回傳符合 schema 的結構化資料。
- 每個摘要項目都必須帶來源引用；無法驗證的項目不得當成臨床事實顯示。

### D8：第一個遠端 API

- 第一個遠端 API 使用 OpenRouter Chat Completions：`https://openrouter.ai/api/v1/chat/completions`。
- 第一個遠端模型固定為 `openai/gpt-oss-120b`。
- OpenRouter 請求必須要求路由至支援 JSON Schema 參數的後端。
- 不接受 content script 或使用者輸入任意 endpoint。

### D9：資料擷取驗證方式

- 日常自動測試只使用合成資料與去識別 fixture；真實資料格式只在合法授權環境人工驗證。
- 2026-08-12 已在原授權分頁完成五個 allow-listed 資料子集、正規化病人快照、來源回查與授權生命週期驗證。
- 驗證紀錄只保存日期、範圍、結果與操作者證明，不保存病人資料、API 回應、token 或 session storage 值。
- 詳細紀錄見[合法健保測試環境驗證紀錄](./NHI_AUTHORIZED_ENVIRONMENT_VALIDATION.md)。

### D11：散布方式

- 第一版僅以 Chrome 開發人員模式載入未封裝的 `dist` 目錄。
- 不上架 Chrome Web Store，也不提供院內管理式散布、集中政策或自動更新。
- 每次更新都必須由操作者從指定原始碼版本重新建置，並在 `chrome://extensions` 手動重新載入。
- 此散布方式只供受控開發與合法測試，不代表已完成院內部署、商店審查或正式臨床上線。
- 安裝前必須完成 `npm run verify`；操作與資料邊界見[開發人員模式散布與安裝指南](./DEVELOPER_MODE_DISTRIBUTION.md)。

## 建議預設，待實作驗證

### D5：遠端 Provider 範圍

- 先支援一個 OpenRouter BYOK Provider。
- Provider endpoint 固定且使用 optional host permission，不接受 content script 傳入任意 URL。

### D6：資料保存

- 病人快照、prompt 與模型回應只可存在執行記憶體或 `chrome.storage.session`，不得寫入持久化儲存。
- 只保存非敏感設定，例如 Provider 類型、模型名稱、UI 偏好。
- 稽核資訊只保存模型、版本、prompt 版本、時間與結果狀態，不保存病歷內容。

### D7：程式碼策略

- 建立獨立的新專案，以參考專案的資料類型與行為作為研究材料。
- 若直接複製 Apache-2.0 授權程式碼，必須保留適用的授權與著作權聲明。

### D10：臨床驗收標準

- 已建立第一個合成案例的必要驗收主張、100% 完整性與來源支持門檻、0% 重大遺漏率，以及零容忍不可接受輸出清單。
- 自動測試只負責 schema、來源存在、內部識別與結構涵蓋；來源是否支持句意及臨床推論邊界不得由關鍵字測試取代。
- 合成 MVP 已於 2026-08-12 完成醫師與藥師簽核；只記錄角色、日期、範圍與結果，不保存簽核人個資。
- 已新增缺漏欄位、矛盾來源、明示危急標記與用藥區間重疊四個合成邊界案例，並於 2026-08-12 由醫師與藥師逐案重新接受。
- 已以 `clinical-rules.v2` 實作同一過敏原明確相反 assertion 的 deterministic 來源矛盾安全訊號；v1 簽核保留為歷史紀錄，v2 已於 2026-08-12 完成重新臨床驗證。
- 詳細標準見 [合成案例臨床驗收標準](./CLINICAL_ACCEPTANCE.md)。
