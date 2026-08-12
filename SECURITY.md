# Security Policy

## Secrets

- API Key 必須由擴充功能設定頁在執行時輸入。
- API Key 只允許存在 `chrome.storage.session`，並限制為 trusted extension contexts。
- 不得將 API Key 放入原始碼、`VITE_*` 變數、環境檔、Git、fixture、測試快照、log 或建置產物。
- 範例值必須使用明顯無效的 placeholder，不得使用真實 Key 的截短版本。

若 Key 曾出現在 commit、公開訊息或建置產物，應先立即撤銷或輪替；僅刪除檔案或改寫最新 commit 不代表秘密已安全移除。

## Medical data

- 開發與自動測試一律使用合成資料。
- 不得提交健保雲端畫面截圖、網路封包、API 回應或由真實病歷衍生的 fixture。
- 病人資料、prompt 與模型回應不得進入 console、分析服務或遠端錯誤追蹤。
- 切換病人、登出、授權失效或取消操作時，必須清除暫存資料並中止進行中的請求。

## Reporting

發現 secret 或病人資料可能外洩時，停止使用受影響的憑證與資料流程，記錄不含敏感內容的時間與影響範圍，完成撤銷、輪替及清除後再恢復測試。
