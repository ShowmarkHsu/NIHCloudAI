# OpenRouter 端對端驗證紀錄

本文件只記錄不含病人資料與秘密的驗證範圍及結果。不得加入 API Key、request／response body、病人識別、臨床欄位實值、畫面截圖、token 或 session storage 值。

## 2026-08-12 完成驗證

- 證據來源：合法測試環境操作者回報；未在專案內保存遠端請求或模型輸出內容。
- 散布方式：Chrome 開發人員模式載入已通過 `npm run verify` 的未封裝 `dist`。
- Provider：OpenRouter Chat Completions，固定 endpoint `https://openrouter.ai/api/v1/chat/completions`。
- 模型：`openai/gpt-oss-120b`。
- 已驗證 session-only BYOK、optional host permission、無病歷 Provider 連線測試與資料外送明示同意流程。
- 已從合法健保測試環境的正規化病人快照完成遠端摘要端對端流程。
- 模型輸出已通過 schema、來源引用、內部識別、確定性安全訊號涵蓋與重要度不得降級檢查，並可在 UI 顯示來源導航。
- 結果：通過。

## 驗證邊界

- 通過結果只適用於當次 Chrome、擴充功能、endpoint、模型、prompt、schema 與 `clinical-rules.v2` 組合。
- API Key 與病人資料未納入驗證證據保存；重新載入或移除擴充功能後，session-only 資料應失效。
- OpenRouter 可用性、費率、模型後端變更，以及其他 Provider 或模型不在本次驗證範圍。
- 此技術驗證不代表真實臨床效能、法規核准、Chrome Web Store 發布或院內正式部署。
