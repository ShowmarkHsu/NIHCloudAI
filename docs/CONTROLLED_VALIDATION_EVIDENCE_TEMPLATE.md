# 受控人工驗證證據與簽核紀錄（非 PHI）

本表配合 [受控人工驗證 Runbook](./CONTROLLED_MANUAL_VALIDATION_RUNBOOK.md)
使用。它記錄可審計的最小驗證結果，不得填入病人 identity、session ID、source
ref、secret、Provider request／response、raw payload、HAR、console 匯出或 screenshot。

## 執行識別

| 欄位 | 填寫值 |
| --- | --- |
| 日期與時區 | |
| 執行者角色（不填個資） | |
| 已審查 commit | |
| Chrome 版本 | |
| Extension 顯示版本 | |
| 合成案例 ID | |
| 受控環境／profile 識別 | |

執行前確認：`npm ci`、`npm run verify`、`git status --short` 成功或為空；已關閉
console／proxy／HAR／錄影／screenshot／剪貼簿歷史等可能保存敏感內容的機制。

## 驗證紀錄

結果僅可填「通過」、「失敗」或「未執行（外部資源未提供）」。證據欄只可填本表
的執行識別、時間與非敏感的錯誤類別。

| 項目 | 結果 | 非敏感證據／時間 |
| --- | --- | --- |
| Developer-mode 從已審查 `dist` 安裝、更新及移除 | | |
| `chrome-extension://…/ai-frame.html` 隔離 iframe 載入 | | |
| Sealed lab coverage 與「檢驗來源 N」別名，未暴露 raw ref／identity | | |
| Revision／合成病人切換後，舊 scope、摘要、review、copy 均失效 | | |
| Ollama：拒絕 exact optional permission 時 fail closed | | |
| Ollama：exact loopback grant、timeout、取消與完整五段輸出驗證 | | |
| Ollama：非空合成 `has-data` 的三個 fresh-session bounded 結果 | | |
| Ollama：來源明示 `no-known-allergy` 的三個 fresh-session bounded 結果 | | |
| Ollama：過敏與 `no-known-allergy` 同時存在時的固定衝突提示 | | |
| Ollama：隔離 built-MV3 localhost bridge UI 的三個 fresh-tab bounded 結果 | | |
| Ollama：installed extension direct-origin／optional-permission 人工結果 | | |
| Ollama：none-word 失敗時只記 bounded 子類別，未擷取內容 | | |
| OpenRouter：拒絕 exact optional permission 時 fail closed | | |
| OpenRouter：session-only BYOK、明確 consent、固定 route | | |
| OpenRouter：Provider 僅摘要 has-data facts，本機 deterministic coverage wording 符合核准案例 | | |
| OpenRouter：取消、revision、病人切換、登出／關閉 tab 後 secret 與 consent 失效 | | |
| 未保存 PHI、secret、raw payload、request body、response、HAR 或 screenshot | | |

## 例外與停止條件

若任何紀錄、畫面、terminal 或工具輸出可能含 PHI、secret 或 Provider payload，停止
驗證，依受控環境的事件處理程序處置；本表只記錄「敏感資料處理程序已啟動」，不記錄
內容。不得以真實病人資料替代合成案例，或自行擴大 host permission、origin、sender
或資料邊界。

## 必要外部簽核

本表的簽核僅確認各角色已審閱相應的非 PHI 證據；不等同自動 clinical 或 release
核准。未適用或尚未取得時須明確標示，不能視為通過。

| 角色／責任 | 狀態（核准／拒絕／待補） | 簽核參照或受控系統連結 |
| --- | --- | --- |
| 授權操作者：runbook 完整性與非 PHI 執行 | | |
| 臨床審閱者：合成案例驗收 | | |
| 藥事審閱者：合成案例驗收 | | |
| 資安／隱私責任者：permission、BYOK、資料保存邊界 | | |
| 院方／環境所有者：受控環境使用 | | |
| Release owner：artifact、provenance 與發布決策 | | |

在所有適用項目與必要簽核完成前，本分支不可宣稱 release ready 或 clinical use。
