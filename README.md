# NICloudAI

NICloudAI 是一個隱私優先的 Chrome 擴充功能原型，用來把健保醫療資訊雲端查詢系統中的近期資料整理成可追溯來源的臨床摘要。

目前凍結基準版本為 `v0.1.0`。版本內容見 [CHANGELOG](./CHANGELOG.md)，重建與回復程序見[發布基準](./docs/RELEASE_BASELINE.md)。

目前專案已完成四段可執行的 MVP 垂直切片：擴充功能可建立標準化病人快照，以確定性規則整理用藥、過敏、檢驗數值趨勢、明示異常與具有明確日期的用藥區間重疊，再由使用者主動選擇本機 Ollama 或 OpenRouter BYOK 產生結構化摘要。第一個遠端模型固定為 `openai/gpt-oss-120b`。設定畫面可先用固定且不含病歷的請求測試連線、模型名稱與結構化輸出能力。規則結果不依賴 LLM，且只有通過 schema、來源引用、確定性安全訊號涵蓋與可見文字內部識別檢查的 AI 摘要才會顯示；模型不得遺漏安全訊號或降低其閱讀優先級。資料與摘要只在 extension session 內暫存。`clinical-rules.v2` 與四個合成邊界案例已於 2026-08-12 完成醫師／藥師重新認證；合法健保測試環境的五個資料子集與 OpenRouter `openai/gpt-oss-120b` 端對端流程亦於同日由操作者回報驗證通過。

## 核心原則

- LLM 只處理標準化後的病人快照，不直接讀取 DOM 或健保 API 原始回應。
- 確定性規則負責數值、時間範圍、趨勢與重疊計算；LLM 只負責整理文字。
- 每個摘要項目都必須引用病人快照中實際存在的來源紀錄。
- 欄位不足時，確定性規則不得推定異常、趨勢或用藥區間重疊。
- 預設使用本機 Ollama；遠端 Provider 採使用者自行提供 API Key（BYOK）。
- API Key 只保存於 `chrome.storage.session`，不進入原始碼、Git、環境檔或建置產物。
- Provider 連線測試使用程式內固定 JSON 請求，不讀取或傳送病人快照。

## 開發

```powershell
npm install
npm test
npm run typecheck
npm run build
npm run verify
```

第一版只以 Chrome 開發人員模式載入未封裝的 `dist` 目錄，不上架 Chrome Web Store，也不視為院內正式部署版本。安裝、手動更新、移除、權限與資料處理邊界請依照[開發人員模式散布與安裝指南](./docs/DEVELOPER_MODE_DISTRIBUTION.md)。

詳細的產品與安全邊界請參考：

- [領域詞彙](./CONTEXT.md)
- [MVP 規格](./docs/MVP_SPEC.md)
- [決策地圖](./docs/DECISION_MAP.md)
- [實作計畫](./docs/IMPLEMENTATION_PLAN.md)
- [發布基準](./docs/RELEASE_BASELINE.md)
- [合成案例臨床驗收標準](./docs/CLINICAL_ACCEPTANCE.md)
- [合法健保測試環境驗證紀錄](./docs/NHI_AUTHORIZED_ENVIRONMENT_VALIDATION.md)
- [OpenRouter 端對端驗證紀錄](./docs/OPENROUTER_E2E_VALIDATION.md)
- [開發人員模式散布與安裝指南](./docs/DEVELOPER_MODE_DISTRIBUTION.md)
- [安全政策](./SECURITY.md)

## 尚未提供

- 其他 Ollama 模型，以及 OpenRouter 以外遠端 Provider 的端對端相容性驗證。
- 重複檢查、跨藥物交互作用與需要臨床知識庫的進階規則。
- Chrome Web Store 上架、院內管理式散布與自動更新流程。

本工具只提供資料摘要與來源導航，不提供診斷或治療建議。
