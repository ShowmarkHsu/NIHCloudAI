# 開發環境

正式 `dist` 的建置、Chrome 開發人員模式安裝、手動更新與移除程序，請依照[開發人員模式散布與安裝指南](./DEVELOPER_MODE_DISTRIBUTION.md)。

## API Key

不要在本專案建立含真實 API Key 的 `.env`，也不要使用 `VITE_*_API_KEY`。Vite 前端環境變數會進入瀏覽器建置產物，不能視為秘密。

BYOK Key 應在已載入的擴充功能設定畫面中輸入。Key 只存在當次 extension session；瀏覽器或擴充功能重新啟動後，需要再次輸入。

使用 OpenRouter 產生摘要時，擴充功能會要求使用者勾選資料外送提醒，並由 Chrome 取得 `https://openrouter.ai/*` optional host permission。未同時取得同意與權限時，不會送出病歷快照。第一個遠端模型固定為 `openai/gpt-oss-120b`。

設定畫面的「測試 Provider 連線」只會傳送程式內固定的 `{ "status": "ok" }` 結構化輸出測試，不會讀取病人快照。遠端測試仍需要 optional host permission 與已設定的 session API Key，但不等同同意外送病歷資料。

## Ollama

1. 安裝並啟動本機 Ollama。
2. 建置並載入擴充功能，從 `chrome://extensions` 取得 extension ID。
3. 將 Ollama 的允許來源限制為該 extension origin，例如 `chrome-extension://<extension-id>`，再重新啟動 Ollama。
4. 不要以允許所有瀏覽器擴充功能來源作為正式預設值。

預設 endpoint 是 `http://localhost:11434`。本機 Ollama 不需要 API Key。

## 測試資料

- `src/domain/fixtures.ts` 只能包含明確虛構的合成資料。
- 不要把真實病歷、畫面截圖、網路封包或健保 API 回應放進專案。
- 如果必須在本機人工檢查真實資料，產生的檔案必須留在 `.gitignore` 已排除的私人目錄，而且完成後應立即清除。

## 合成 Chrome / Ollama smoke

`dist-smoke` 是獨立的合成測試擴充功能建置。它只允許
`http://127.0.0.1:4173/smoke/*`、本機 Ollama 與 `chrome.storage.session`，
不包含健保雲端或遠端 Provider host permission，不能取代正式 `dist` 的授權環境驗證。

```powershell
npm run build:smoke
npm run serve:smoke
npm run smoke:ollama -- --model <已安裝的本機模型名稱>
```

在 Chrome 開發人員模式載入 `dist-smoke` 後，開啟
`http://127.0.0.1:4173/smoke/index.html`。頁面只會要求 smoke content script
從程式內建 fixture 發布合成病人 A 或 B；頁面本身不能提供任意病人快照。
切換或清除工作階段後，重新開啟擴充功能 UI 以讀取最新狀態。

## 檢查順序

```powershell
npm test
npm run typecheck
npm run build
node scripts/secret-scan.mjs
```

任何一項失敗都不應把 `dist` 視為可供測試的建置產物。第一版不產生可發布至 Chrome Web Store 或院內管理式散布的壓縮檔。
