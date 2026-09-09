# 受控人工驗證 Runbook（非 PHI）

狀態：本文件是 R2/R3 的人工驗證準備，不是臨床驗收、正式發布核准或
Provider 合格證明。僅可在受控 Chrome profile、已審查 commit 與核准的合成
測試頁面進行。不得使用真實病人、真實病歷、正式帳號以外的未授權資料，或把
任何 PHI 帶入記錄、issue、commit、terminal、request body、response、HAR、
DevTools 匯出或 screenshot。

每次執行以[受控人工驗證證據與簽核紀錄](./CONTROLLED_VALIDATION_EVIDENCE_TEMPLATE.md)
記錄最小、非敏感的證據與外部簽核狀態。
完成的結果須依[Release evidence 封裝與雜湊準備](./RELEASE_EVIDENCE_PREPARATION.md)
拆成五個獨立、不可變的 evidence objects；空白範本與歷史觀察不得產生 release input。

## 前置與可保存的最小證據

1. 從已審查的 `codex/*` commit 執行 `npm ci` 與 `npm run verify`；兩者必須
   成功，且 `git status --short` 為空。
2. 記錄日期、操作者角色、commit、Chrome 版本、extension 顯示版本、合成案例
   ID，以及每一項的 pass/fail。這些欄位不得包含病人、session ID、source ref、
   key、Provider request/response 或畫面內容。
3. 關閉或遮蔽會自動保存的 console、proxy、HAR、錄影、螢幕截圖與剪貼簿歷史。
   若任何一項意外含有 PHI、secret 或 Provider payload，立即依環境程序處理，
   不要複製到本 repository。

## Developer-mode 安裝、更新與移除

1. 在 `chrome://extensions` 開啟「開發人員模式」，選擇「載入未封裝項目」，只
   指向剛由該 commit 建置的 `dist`。
2. 核對擴充功能名稱、Chrome build version、沒有載入錯誤；不要選取 repository
   root、`src` 或舊 `dist`。
3. 更新時，先結束目前資料工作階段且不匯出資料，切換到已審查 commit，重新跑
   gate，再於 `chrome://extensions` 按「重新載入」。回復亦只能由已審查 commit
   重建，不覆蓋未知來源 artifact。
4. 移除時，在 `chrome://extensions` 按「移除」，依受控環境程序清除網站登入
   狀態，並確認不存在舊載入項目。移除 extension 不會替其他系統登出。

## 合成 lab vertical slice 與 iframe

1. 在核准的合成 NHI 測試頁，完成能產生 terminal `labdata` 結果的流程；不要將
   terminal row、DOM 或網路內容保存下來。
2. 開啟既有浮動介面中的「AI 摘要」頁籤。確認 coverage 對檢驗顯示筆數或明確
   terminal 狀態；未收集家族須顯示「本次未收集」，不能被描述成陰性或正常。
3. 確認載入的是 `chrome-extension://…/ai-frame.html` 隔離 iframe。iframe 只可
   顯示 coverage 與本地「檢驗來源 N」別名；不得顯示病人 identity、source ref、
   raw row、endpoint、model、prompt 或 Provider payload。
4. 重新觸發同一合成案例的 revision 或切換至另一合成病人；舊摘要、review 與 copy
   必須失效，且舊 iframe scope 顯示 stale 而不可生成或複製。

## Ollama（本機、選用權限）

僅在授權操作者已準備固定本機 Ollama 模型及可用硬體時執行成功路徑。否則只執行
permission-denied、timeout 與 cancel 路徑並記錄為「外部資源未提供」，不是失敗。

1. 先拒絕 `http://127.0.0.1:11434/*` optional host permission。按「生成本機
   Ollama 摘要」後，確認 UI 顯示權限不足，沒有摘要或可複製內容。
2. 重新選擇生成並只授予該 exact loopback permission；確認沒有新增廣泛 host
   grant。若本機服務未回應，等待固定 timeout，確認沒有 partial draft 或 copy。
3. 在生成中按 iframe 的「取消生成」。確認狀態為取消、摘要與 copy 清空；再按
   一次生成必須是新的使用者動作。
4. 僅在成功回應時，確認輸出恰為固定五段、每段僅對應本地來源別名、沒有 partial
   output。review 前 copy 必須停用；編輯、重新生成、錯誤、timeout 或取消後 copy
   再次失效。
5. 對非空合成 `has-data` scope 另以三個 fresh data sessions 重複步驟 4。只記錄每次
   bounded PASS／失敗類別；不得保存摘要、來源 alias 值、request／response、log、HAR、
   screenshot 或 clipboard。CLI repeatability 不可代替 built-extension UI、臨床品質或
   release acceptance；隔離 localhost bridge 的 built-MV3 自動化亦不可代替 installed-extension
   direct-origin 與 optional-permission 人工驗證。
6. 以來源明示 `no-known-allergy` 的核准合成案例重複步驟 4；另以同時含來源明示過敏
   與 `no-known-allergy` 的核准合成案例確認只出現受控固定衝突提示。只記錄 bounded
   PASS／失敗類別，不保存摘要文字或 aliases。這兩種固定措辭已於 2026-08-27 取得
   臨床與藥事逐組 wording 核准；即使工程驗證通過也不得視為整體 clinical acceptance。
7. 若仍出現 none-word 失敗，只記錄 UI 顯示的 bounded 子類別：非允許節、同節多個
   「無」、與過敏無關、sealed 過敏來源不支持或過敏片語不在窄窗。不得開啟 console、
   擷取 response、複製摘要或以 screenshot／HAR／log 擴大診斷資料。
8. 若子類別為非允許節，只再記錄 UI 顯示的固定節別與「引用來源有明示支持／未明示
   支持」；不得記錄是哪一筆來源、來源值、alias、片語或筆數。
9. 對【近期病程與檢查】／【住院、手術與出院】的來源未支持 none-word 合成案例，確認
   Provider 原敘述未顯示，改為固定人工核對提示、aliases 仍可回查，且 review 前 copy
   維持停用。固定提示與 aliases 呈現已於 2026-08-27 取得臨床與藥事逐組 wording
   核准；這不代表整體 clinical acceptance。

## OpenRouter（遠端、session-only BYOK）

成功路徑需要授權帳號與 key；在其不可用時，執行拒絕與失效案例即可，絕不以真實
病人資料代替合成案例。

1. 先拒絕 `https://openrouter.ai/*` optional host permission；選擇遠端摘要後應
   停在 permission-required，沒有外送與摘要。
2. 只授予該 exact host permission。未填 BYOK 或未勾選明確的 sealed snapshot
   外送同意時，生成必須停止，沒有外送。不要記錄或顯示輸入的 key。
3. 只有操作者有授權 key 時，於當前合成 session 輸入 BYOK、勾選同意、主動生成。
   確認固定 route 行為成功或受控失敗；不要保存 request body、response、key、
   raw payload、HAR 或 screenshot。
   對 lab-only 案例另確認【目前用藥與過敏】、【住院、手術與出院】及
   【資料缺口與待確認】只使用已核准的本機 deterministic coverage wording；Provider
   只摘要 `has-data` facts。不得用 Provider payload、log 或 screenshot 作為證據。
4. 按取消、切換合成病人、推進 revision、登出與關閉 tab 各驗一次。每次後先前
   BYOK、同意、摘要、review 與 copy 都必須不可用；回到新 scope 必須重新輸入 key
   並重新同意。不得依賴 persistent storage 恢復它們。

## 結束條件與升級

本 runbook 的全部適用步驟通過，僅表示可進入下一輪受控人工驗證；它仍不表示
release ready 或 clinical use。成功 Provider round-trip、臨床／藥事審查、資安與院方
核准、release owner 的 artifact/provenance 決策都必須另行取得。遇到真實資料、真實
授權、外部模型／硬體或任何需保留內容的問題時停止，不要自行擴大資料流或權限。
