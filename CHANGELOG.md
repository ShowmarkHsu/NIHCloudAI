# 變更紀錄

本專案採用語意化版本號。第一版只以 Chrome 開發人員模式載入未封裝擴充功能，不提供 Chrome Web Store 或院內管理式發布。

## [0.1.0] - 2026-08-12

第一個已凍結且完成技術驗證的 MVP 基準。

### 新增

- Chrome Manifest V3 擴充功能、React popup 與 background service worker。
- 健保雲端薄型 adapter，以及 medication、allergy、lab、imaging、discharge 五個 allow-listed 資料子集。
- 具來源引用的正規化病人快照、確定性臨床規則與結構化摘要。
- 本機 Ollama Provider，以及 session-only BYOK 的 OpenRouter Provider。
- OpenRouter 固定模型 `openai/gpt-oss-120b`、optional host permission 與病歷外送明示同意。
- 摘要 schema、來源存在、內部識別、安全訊號完整涵蓋與重要度不得降級檢查。
- 合成資料、golden tests、Chrome／Ollama smoke 與 secret scan。
- Chrome 開發人員模式的安裝、更新、移除與回復流程。

### 驗證

- `clinical-rules.v2` 與四個合成邊界案例完成醫師／藥師重新認證。
- 合法健保測試環境的五個資料子集、正規化快照、來源回查與授權生命週期驗證通過。
- OpenRouter `openai/gpt-oss-120b` 端對端人工驗證通過。
- 發布前完整自動驗證通過：25 個測試檔、122 項測試、型別檢查、production build 與 secret scan。

### 限制

- 不提供診斷、治療或處方建議。
- 不代表真實臨床效能、法規核准或院內正式部署。
- 不包含 Chrome Web Store、集中政策、自動更新或撤回機制。
- 其他模型與 Provider 不在本次驗證範圍。
