# 開發人員模式散布與安裝指南

本分支只能以 Chrome 開發人員模式載入，供受控開發與合法測試使用；它不是 Chrome Web Store、院內管理式部署或正式臨床系統。請使用受控 Chrome profile 與已審查的原始碼版本，絕不把真實病歷、畫面截圖、網路封包或秘密放進本專案。

## 建置與安裝

1. 在專案根目錄執行 `npm run verify`。
2. 在 Chrome 開啟 `chrome://extensions`，開啟「開發人員模式」。
3. 選擇「載入未封裝項目」，指定剛產生的 `dist` 目錄。
4. 核對名稱、版本與錯誤列表，再以合法且核准的測試流程操作。

不得載入專案根目錄、`src`、舊版 `dist`，或包含未審查檔案的目錄。

## 更新、回復與移除

更新前先結束目前工作階段，不匯出資料。切換至已審查 commit，重新執行 `npm run verify`，再於 `chrome://extensions` 選擇「重新載入」。回復版本時同樣從已審查 commit 重建，不要覆蓋不明來源的 `dist`。

移除時，在 `chrome://extensions` 選擇「移除」，並依授權測試環境的程序清除網站端登入狀態。擴充功能移除不會替其他系統登出。

## 現行權限與資料邊界

- `storage`：既有 extension 設定與資料狀態。
- `clipboardWrite`：既有使用者主動複製功能。
- `https://medcloud2.nhi.gov.tw/*`：既有 content script 的固定健保雲端範圍。
- `https://drugtw.com/*`：既有藥品圖片功能。

AI Provider 僅能由 background 執行；content script 沒有讀取或保存 API key 的能力。`http://127.0.0.1:11434/*`（Ollama loopback）及 `https://openrouter.ai/*` 是精確的 optional host permissions，不是常駐 host permissions。只有使用者選擇 Provider 後才可請求該 host；首次對 OpenRouter 外送前，必須顯示資料外送同意並取得當前 data session 的明確同意。BYOK 僅存在 background 的記憶體、限當前 session，登出、換病人、關閉分頁或取消後不得保留。

## Provider 手動檢核

1. 先在核准的合成測試頁面啟動資料 session；不得使用真實病歷。
2. 確認 Chrome 只在使用者選取 Ollama 或 OpenRouter 時請求對應 optional host permission，且沒有廣泛 host grant。
3. 確認 OpenRouter 第一次外送前會要求同意；拒絕或取消時沒有網路請求。
4. 在沒有任何病歷連線的環境確認 timeout、取消與錯誤狀態；不得擷取或保存 request、response、金鑰、session 值或截圖。

## AI 摘要手動檢核

1. 只用核准的合成資料，確認 AI 摘要頁先顯示資料狀態，且生成按鈕必須由使用者主動按下。
2. 確認輸出固定為五段，逐段可查看來源 reference；不得把原始病歷、姓名、識別碼或 Provider 資訊顯示或複製到摘要。
3. 確認「確認 review」前複製按鈕停用；編輯、重新生成、錯誤、取消、登出、換病人或關閉 tab 後均不得複製。
4. 此手動檢核不產生截圖、request/response、金鑰或 session 值，也不更新 visual snapshots。
