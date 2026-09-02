# 開發人員模式散布與安裝指南

## 適用範圍

NICloudAI 第一版只以 Chrome 開發人員模式載入未封裝擴充功能，供受控開發與合法測試使用。這不是 Chrome Web Store 版本，也不是院內管理式部署或已核准的正式臨床系統。

操作者必須使用受控的 Chrome 使用者設定檔與明確指定的原始碼版本。不要從共用、公開或自動同步的目錄載入擴充功能，也不要把含有真實病歷、API Key、畫面截圖或網路封包的檔案放進專案目錄。

## 建置前檢查

在專案根目錄執行：

```powershell
npm install
npm run verify
```

只有完整驗證通過後，才可使用產生的 `dist` 目錄。`dist-smoke` 僅供合成資料與本機 Ollama smoke，不得用於合法健保測試環境。

## 安裝

1. 在 Chrome 開啟 `chrome://extensions`。
2. 開啟頁面右上角的「開發人員模式」。
3. 選擇「載入未封裝項目」。
4. 選取本專案建置後的 `dist` 目錄。
5. 確認擴充功能名稱為 NICloudAI，版本與 `public/manifest.json` 一致，且沒有載入錯誤。
6. 將 Chrome 顯示的 extension ID 記錄在受控的本機測試紀錄；若使用 Ollama，只允許該 extension origin 存取 Ollama。

不要載入專案根目錄、`src` 或 `dist-smoke` 來執行正式授權環境測試。

## 手動更新與回復版本

開發人員模式沒有本專案的自動更新流程。更新時：

1. 結束目前病人的摘要工作階段，不保留或匯出真實病歷內容。
2. 切換到明確指定且已審查的原始碼版本。
3. 重新執行 `npm run verify`，產生新的 `dist`。
4. 回到 `chrome://extensions`，在 NICloudAI 卡片選擇「重新載入」。
5. 重新確認版本、權限、Provider 與模型；OpenRouter API Key 必須重新輸入。

需要回復舊版時，依[發布基準](./RELEASE_BASELINE.md)從 annotated Git tag 取出已知且已驗證的原始碼，重新建置 `dist`，再依相同步驟重新載入。不要用未記錄來源的舊 `dist` 覆蓋目前版本。

## 移除

1. 先結束病人工作階段並關閉 NICloudAI popup。
2. 在 `chrome://extensions` 的 NICloudAI 卡片選擇「移除」。
3. 確認擴充功能已不在清單中。

移除或重新載入擴充功能會使 session-only API Key 與工作階段資料失效。健保網站自身的登入狀態與網站資料屬於另一個系統，必須依該測試環境的登出與清除程序處理。

## 權限與資料處理邊界

目前 manifest 宣告的範圍如下：

- `storage`：保存 extension session 內的 API Key、病人快照與摘要，以及非敏感設定；API Key 不寫入持久化儲存。
- `https://medcloud2.nhi.gov.tw/imu/*`：只在合法授權的健保雲端頁面執行 content script，以建立正規化病人快照。
- `http://localhost:11434/*` 與 `http://127.0.0.1:11434/*`：連接操作者本機的 Ollama。
- `https://openrouter.ai/*`：optional host permission；只有使用者選擇 OpenRouter 時才要求授權。

OpenRouter 病歷摘要請求只有在使用者主動勾選資料外送提醒、Chrome 已授予 optional host permission，且當次 session 已輸入 API Key 時才可送出。Provider 連線測試只傳送程式內固定且不含病歷的測試資料。使用遠端 Provider 前，操作者仍須確認其組織允許將測試資料交由該服務處理。

病人快照、prompt、模型回應與摘要不得寫入 Git、環境檔、console、持久化瀏覽器儲存或錯誤回報。真實授權資料不得成為 fixture、測試快照或文件附件。

## 每次測試前確認

- `npm run verify` 已在預定原始碼版本通過。
- Chrome 載入的是該次建置的 `dist`，不是 `dist-smoke` 或舊目錄。
- 擴充功能版本、extension ID 與測試紀錄一致。
- 使用合法測試帳號，且只操作核准的測試病人。
- OpenRouter 模型顯示為固定的 `openai/gpt-oss-120b`。
- 遠端資料外送已取得當次測試所需的組織授權與使用者明示同意。
- 測試完成後已清除工作階段，且沒有留下真實病歷或 API Key 檔案。

## 已知限制

- 沒有 Chrome Web Store 的簽署、審查、發布與自動更新保障。
- 沒有院內集中安裝、版本鎖定、政策控管或撤回機制。
- 更新、回復版本與 extension ID 核對皆由操作者手動執行。
- 開發人員模式警示與瀏覽器版本相關行為可能影響測試流程。
- 2026-08-12 的通過結果只涵蓋當次合法測試環境、Chrome 開發人員模式建置與 OpenRouter `openai/gpt-oss-120b`；環境、權限、模型、prompt、schema 或規則版本變更時必須重新驗證。
- 技術端對端驗證不等同真實臨床效能、正式發布或院內部署驗證。
