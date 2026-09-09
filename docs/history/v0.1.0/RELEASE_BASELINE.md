# 發布基準

## v0.1.0

| 項目 | 凍結值 |
| --- | --- |
| 發布日期 | 2026-08-12 |
| Git tag | `v0.1.0`（annotated tag） |
| npm package version | `0.1.0` |
| Chrome manifest version | `0.1.0` |
| 散布方式 | Chrome 開發人員模式載入未封裝 `dist` |
| 遠端 Provider | OpenRouter Chat Completions |
| 遠端模型 | `openai/gpt-oss-120b` |
| Prompt | `clinical-summary-prompt.v1` |
| Schema | `clinical-summary.v1` |
| 確定性規則 | `clinical-rules.v2` |
| 自動驗證 | 25 個測試檔、122 項測試、typecheck、production build、secret scan 通過 |
| 人工驗證 | 醫師／藥師重新認證、合法健保五個資料子集、OpenRouter E2E 通過 |

tag 所指向的提交是原始碼與文件的唯一發布基準。`dist` 是可重建產物，不納入 Git；不得把某個未記錄來源的本機 `dist` 當成回復依據。`dist-smoke` 是合成 smoke 測試資產，不是正式授權環境發布物。

## 建立與驗證規則

- `package.json`、`package-lock.json` 根套件版本與 `public/manifest.json` 必須完全一致。
- tag 名稱使用 `v<version>`，例如 `v0.1.0`。
- 建立 tag 前，工作樹中的預定發布內容必須全部納入單一基準提交。
- 必須執行 `npm run verify`，且不得略過版本檢查、測試、型別檢查、production build 或 secret scan。
- 人工驗證紀錄不得包含病歷內容、API Key、token、原始 API 回應或畫面截圖。

## 從 v0.1.0 重建

為避免改動目前工作目錄，建議從 tag 建立獨立 worktree：

```powershell
git worktree add ..\NICloudAI-v0.1.0 v0.1.0
Set-Location ..\NICloudAI-v0.1.0
npm ci
npm run verify
```

驗證通過後，在 Chrome 的 `chrome://extensions` 開啟開發人員模式，載入該 worktree 產生的 `dist`。

## 回復程序

1. 結束目前病人工作階段，不匯出或保存病歷內容。
2. 依上節從 `v0.1.0` 建立獨立 worktree 並執行 `npm ci`、`npm run verify`。
3. 在 `chrome://extensions` 移除目前版本，或將既有未封裝擴充功能改載入已驗證 worktree 的 `dist`。
4. 核對 manifest 顯示版本為 `0.1.0`，並記錄 Chrome 顯示的 extension ID。
5. 重新設定 Ollama origin 或輸入 OpenRouter session API Key；不得從舊版複製 session storage。
6. 執行不含病歷的 Provider 連線測試，再開始合法測試。

## 變更後的重新驗證

原始碼、依賴、manifest 權限、Provider endpoint／模型、prompt、schema 或確定性規則有任何變更時，都不得繼續宣稱為 `v0.1.0`。應更新版本號與 CHANGELOG，依變更範圍重新進行自動、臨床及端對端驗證，再建立新的基準提交與 annotated tag。
