# BYOK 金鑰只存在受信任的 extension session

開發階段需要由單一開發者使用自己的 API Key 呼叫遠端 LLM，但瀏覽器擴充功能無法安全地隱藏編入程式或建置產物的秘密。因此 API Key 只由設定頁輸入並保存在記憶體型 session storage，由 background service worker 讀取；content script、病歷頁面、原始碼、環境變數與持久儲存均不得取得金鑰。代價是瀏覽器或擴充功能重新啟動後必須再次輸入金鑰。

## Consequences

- 金鑰設定流程必須提供已設定狀態、連線測試及立即清除功能，但不能回傳完整金鑰。
- 遠端請求只能由 background service worker 對核准的 Provider endpoint 發出。
- 所有 log、錯誤物件與測試輸出必須在序列化前移除 Authorization header 和秘密欄位。
