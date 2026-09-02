# NICloudAI MVP 規格

## 目標

在醫事人員已合法開啟健保醫療資訊雲端查詢系統並取得單一病人資料後，提供一個容易閱讀、可回查來源的近期病歷摘要，縮短掌握病人狀況所需時間。

## 非目標

- 不產生診斷、鑑別診斷、疾病風險分數或治療建議。
- 不自動寫回院內 HIS、EMR 或健保雲端。
- 不永久保存病人資料、prompt 或模型回應。
- 不在第一版實作多人、院內伺服器或集中式金鑰管理。

## 使用流程

1. 醫事人員以原有方式登入健保雲端並開啟病人資料。
2. 擴充功能擷取目前授權範圍內的資料，建立病人快照。
3. 畫面先顯示資料類型、筆數與擷取時間，讓使用者確認病人已正確切換。
4. 醫事人員按下「產生 AI 摘要」。系統不得在未操作時自動外送資料。
5. 本機規則先產生臨床事實與安全訊號，再交給選定 Provider 整理。
6. 輸出通過 schema 與來源驗證後顯示；每一項均可展開或跳回來源紀錄。
7. 病人切換、登出或授權失效時，清除病人快照、摘要與進行中的請求。

## 摘要內容

- 近期重要就醫、住院、手術與檢查事件時間軸。
- 目前或可能仍在使用的西藥與中藥。
- 過敏紀錄。
- 近期異常檢驗及重要趨勢。
- 影像報告與出院摘要中的明確結論。
- 由規則確認的時間重疊用藥或重複檢查。
- 資料缺漏、矛盾或無法確定的項目。

## Provider

### Ollama

- 預設 endpoint：`http://localhost:11434`。
- 不需要 API Key。
- 使用者選擇本機已安裝的模型。
- 必須支援 JSON 或 JSON Schema 格式輸出。

### OpenRouter BYOK

- API Key 由設定頁輸入，只保存於 extension session。
- Provider endpoint 固定為 `https://openrouter.ai/api/v1/chat/completions`。
- 第一個遠端模型固定為 `openai/gpt-oss-120b`，並要求路由至支援 JSON Schema 的後端。
- 「測試連線」不得包含任何病人資料。
- 第一次將病人資料送至 OpenRouter 前，必須顯示目的地與資料外送提醒。

## 輸出契約

每個摘要項目至少包含：

- `id`：本次摘要內的識別。
- `section`：時間軸、用藥、過敏、檢驗、影像、住院或未確定項目。
- `text`：給醫事人員閱讀的繁體中文敘述。
- `sourceRefs`：一個以上來源引用；未確定項目可引用造成矛盾的多筆紀錄。
- `importance`：`routine`、`attention` 或 `urgent-review`；這是閱讀排序，不是診斷分級。

每份摘要另須保存不含病歷內容的摘要生成脈絡：Provider、模型、prompt 版本、schema 版本與確定性規則版本。popup 可顯示這些版本，但不得因此暴露病人或工作階段識別。

驗證器必須拒絕未知欄位、無效 section、空白來源引用，以及不存在於病人快照內的來源引用。
`text` 不得直接顯示病人、工作階段、來源紀錄、規則事實或安全訊號的內部識別；來源識別只能存在 `sourceRefs`，由 UI 呈現為可回查來源。
每個確定性安全訊號都必須由至少一個包含其全部來源引用的摘要項目涵蓋，且摘要項目的 `importance` 不得低於訊號的 `severity`。這是結構涵蓋檢查；來源是否支持可見文字的句意仍須由臨床角色審查。

## 安全需求

- content script 不得取得 API Key。
- background service worker 不接受任意 URL 或任意 request headers。
- API Key 不得寫入 `chrome.storage.local`、`chrome.storage.sync`、LocalStorage 或 IndexedDB。
- 病人資料不得寫入 console、錯誤追蹤、分析服務或測試快照。
- 遠端 Provider 權限採最小化 host permission。
- 所有資料擷取與 Provider 呼叫都可取消，病人切換時必須取消。
- UI 必須區分原始資料、確定性安全訊號與 AI 整理文字。

## MVP 驗收條件

- 使用合成 fixture 可完整建立病人快照並產生摘要。
- 每個可見摘要項目都能定位到至少一筆來源紀錄。
- 模型回傳不存在的來源引用時，該結果不會顯示。
- 瀏覽器重啟或擴充功能重新載入後，BYOK Key 不存在。
- 搜尋原始碼、Git index 與建置產物找不到測試用真實 Key。
- content script 無法讀取 session secret。
- 切換病人後，前一位病人的快照與摘要不再可存取。
