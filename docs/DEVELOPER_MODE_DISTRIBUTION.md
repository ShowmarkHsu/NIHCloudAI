# 開發人員模式散布與安裝指南

本分支只能以 Chrome 開發人員模式載入，供受控開發與合法測試使用；它不是 Chrome Web Store、院內管理式部署或正式臨床系統。請使用受控 Chrome profile 與已審查的原始碼版本，絕不把真實病歷、畫面截圖、網路封包或秘密放進本專案。

## 建置與安裝

1. 在專案根目錄執行 `npm run verify:release`。
2. 在 Chrome 開啟 `chrome://extensions`，開啟「開發人員模式」。
3. 選擇「載入未封裝項目」，指定剛產生的 `dist` 目錄。
4. 核對名稱、版本與錯誤列表，再以合法且核准的測試流程操作。

不得載入專案根目錄、`src`、舊版 `dist`，或包含未審查檔案的目錄。

## 更新、回復與移除

更新前先結束目前工作階段，不匯出資料。切換至已審查 commit，重新執行 `npm run verify:release`，再於 `chrome://extensions` 選擇「重新載入」。回復版本時同樣從已審查 commit 重建，不要覆蓋不明來源的 `dist`。

移除時，在 `chrome://extensions` 選擇「移除」，並依授權測試環境的程序清除網站端登入狀態。擴充功能移除不會替其他系統登出。

## 現行權限與資料邊界

- `storage`：既有 extension 設定與資料狀態。
- `clipboardWrite`：既有使用者主動複製功能。
- `https://medcloud2.nhi.gov.tw/*`：既有 content script 的固定健保雲端範圍。
- `https://drugtw.com/*`：既有藥品圖片功能。

此分支不宣告遠端 Provider host permission、iframe 或 Provider runtime；AI tab 只有受測的純 activation contract。將來加入這些能力必須先更新 release gate、文件與人工驗證範圍，不能沿用本文件當作預先授權。
