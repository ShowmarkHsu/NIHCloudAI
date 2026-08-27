# Deterministic coverage wording 臨床／藥事審閱材料

狀態：2026-08-24 臨床與藥事 reviewer 核准當時的四句補長 context；2026-08-26
prompt v5 新增第 5、6 句；clinical-rules.v3 新增來源明示未有已知過敏紀錄的兩種固定
正規化措辭；clinical-rules.v4 新增未獲來源支持狀態敘述的固定移除提示。目前這些新增
文字都待臨床與藥事重新核准。
先前核准只涵蓋當時的固定文字、案例矩陣與 reviewer 問題，不是整體 clinical
acceptance、release approval 或 Provider 合格證明。本文件只列出 background 依 sealed
coverage contract 產生的固定文字；Provider 不負責產生、改寫或補充這些 coverage 文字。

## 審閱邊界

- `has-data` 表示該來源家族存在可摘要的已收集 facts；固定 coverage renderer 不為
  該家族產生缺漏文字。含已收集 facts 的 section 仍須通過完整本機 validator。
- `confirmed-empty` 只映射為「無可用資料」。審閱者必須確認這個詞不會被理解成
  臨床陰性、正常、未用藥、無過敏或不存在相關事件。
- `unauthorized`、`fetch-failure`、`normalization-failure`、`not-collected` 與
  `out-of-scope` 一律映射為「資料缺口，待確認」，不得推論臨床狀態。
- 本文件不含病人 identity、session ID、source ref、secret、Provider request／
  response、raw payload、HAR、log、screenshot 或實際摘要內容。

## 目前實作的逐字措辭

| Sealed coverage 狀態 | 單一來源家族固定文字 |
| --- | --- |
| `has-data` | 不產生 coverage 缺漏文字；只允許摘要已收集 facts |
| `confirmed-empty` | `<來源標籤>：無可用資料` |
| 其餘 terminal state | `<來源標籤>：資料缺口，待確認` |

目前來源標籤固定為：就醫、西藥、中藥、過敏、檢驗、影像、處置、出院、成人
健檢、癌症篩檢、B/C 型肝炎、CKM 衍生資料。

當一個 section 的相關來源家族全部都不是 `has-data` 時，固定文字如下：

| Section | 來源家族 | 組句規則 |
| --- | --- | --- |
| 目前用藥與過敏 | 西藥、中藥、過敏 | 各家族依狀態逐項顯示，以全形分號分隔，句末為全形句號 |
| 近期病程與檢查 | 就醫、檢驗、影像 | 各家族依狀態逐項顯示，以全形分號分隔，句末為全形句號 |
| 住院、手術與出院 | 就醫、處置、出院 | 各家族依狀態逐項顯示，以全形分號分隔，句末為全形句號 |
| 資料缺口與待確認 | 全部十二個來源家族 | 先合併所有 `confirmed-empty` 標籤，再合併所有其他缺口標籤；兩組以全形分號分隔 |

若 phase-one 來源全部都不是 `has-data`，【核對重點】固定為：

> 目前僅有資料涵蓋狀態，未提供可供核對的已收集臨床事實；所有類別均須依固定資料缺口規則由人工確認，不得據此推定任何未提供的臨床結論。

為滿足既有 180–260 個中文字完整格式 gate，只有在全文不足下限時，renderer 依序
於【資料缺口與待確認】附加下列固定句子，達到下限即停止：

1. 各項狀態僅代表本次資料涵蓋情形，仍須由人工逐項核對。
2. 未收集、未授權或取得失敗的資料不得推定其臨床狀態。
3. 超出本階段範圍的類別未納入本次摘要，後續仍待確認。
4. 已確認空值與資料缺口採不同固定文字呈現，避免誤判。
5. 摘要內容僅整理本次已收集且由來源明示的臨床事實，不得補充或推定未提供的結論。
6. 各節仍須回到可核對來源逐項確認，不能取代原始紀錄與專業判讀。

## 來源明示過敏狀態的固定正規化

Provider 仍不得自行推論陰性狀態。只有 sealed allergy record 明確標記
`no-known-allergy`，且 Provider 在【核對重點】或【目前用藥與過敏】使用含「無」的
過敏子句時，background 才會以本機規則取代該子句並補回 sealed source alias。固定
措辭如下；兩句都尚未取得臨床或藥事核准：

| Sealed allergy evidence | 本機固定措辭 | 審閱狀態 |
| --- | --- | --- |
| 只有來源明示 `no-known-allergy` | `來源明示未有已知過敏紀錄` | 待臨床／藥事審閱 |
| 同時有來源明示過敏與 `no-known-allergy` | `來源同時明示過敏與未有已知過敏紀錄，資料可能矛盾，須逐項人工核對` | 待臨床／藥事審閱 |

本機只補入實際支持上述狀態的 sealed allergy aliases。只有過敏陽性 evidence、沒有
`no-known-allergy` evidence、在其他 section 出現、含「無」的局部片語不符合受控過敏
措辭白名單、含多個「無」字，或局部替換後仍殘留任何其他「無」字時，一律 fail
closed。這項規則不改寫 coverage 的
`confirmed-empty`，也不把資料缺口解讀為沒有過敏。

## 未獲來源支持的「無」字狀態敘述

若 Provider 在【近期病程與檢查】或【住院、手術與出院】使用「無」字，而該節宣告的
所有 aliases 對應 sealed records 都沒有來源明示「無」字，clinical-rules.v4 不接受或
改寫該陰性結論，而是移除該節全部 Provider content、保留可供人工核對的 aliases，並
以本機固定句取代：

> 本節含未獲已收集來源明示支持的狀態敘述，該敘述不納入摘要，須回到原始紀錄逐項人工核對

這句目前待臨床與藥事審閱。若任一宣告 alias 的 sealed record 本身含來源明示「無」字，
本規則不會取代，仍由完整 negative-finding validator fail closed；因此本規則不會把僅有
字元相似性的來源內容自動判為支持，也不會保留 Provider 的原始陰性敘述。

## 合成案例審閱矩陣

審閱時只記錄案例類別與 pass/fail，不保存畫面或摘要文字。

| 案例類別 | 應確認的語意 | 臨床 | 藥事 |
| --- | --- | --- | --- |
| lab `has-data`，其餘未收集／超出範圍 | 不得把其他家族描述成陰性、正常或不存在 | pass | pass |
| phase-one 全部沒有 `has-data` | 【核對重點】明確禁止任何未提供的臨床推論 | pass | pass |
| 同時含 `confirmed-empty` 與其他缺口 | 「無可用資料」與「資料缺口，待確認」可清楚區分且不造成陰性推論 | pass | pass |
| 西藥／中藥／過敏全部沒有 `has-data` | 藥事使用者不會把 coverage 狀態誤讀為無用藥或無過敏 | pass | pass |
| 達不到 180 字而附加 context | 第 1–4 句已核准；第 5–6 句不造成重複、矛盾或不當臨床暗示 | 待重新審閱 | 待重新審閱 |
| 來源只明示 `no-known-allergy`，Provider 有／沒有附 alias | 固定措辭忠實表達來源狀態，且只補入 sealed allergy alias | 待審閱 | 待審閱 |
| 來源同時明示過敏與 `no-known-allergy` | 固定衝突措辭不掩蓋陽性紀錄，並要求逐項人工核對 | 待審閱 | 待審閱 |
| 只有過敏陽性 evidence，Provider 卻使用「無過敏」 | 必須 fail closed，不得正規化為陰性結論 | 自動化通過 | 自動化通過 |
| 核對／用藥節的非過敏子句含「無」 | 必須維持既有 fail-closed 防線 | 自動化通過 | 自動化通過 |
| 近期病程／住院節含「無」，引用來源未明示支持 | 移除整節 Provider content，只顯示固定人工核對提示並保留 aliases | 待審閱 | 待審閱 |
| 近期病程／住院節含「無」，任一引用來源本身含「無」 | 不得僅以字元相同視為語意支持，仍須 fail closed | 自動化通過 | 自動化通過 |

## Reviewer 決策

臨床與藥事 reviewer 應分別對下列問題記錄「核准」、「拒絕」或「待補」：

1. 「無可用資料」是否足以限定為資料取得結果，而不會被理解為臨床陰性？
2. 「資料缺口，待確認」是否適用於未授權、取得失敗、正規化失敗、未收集與
   超出範圍，或其中任何狀態需要更明確但仍不暴露技術細節的文字？
3. 「就醫」、「處置」、「出院」等標籤是否與臨床工作語意一致？
4. 「西藥」、「中藥」、「過敏」逐項顯示是否足以防止藥事上的陰性推論？
5. 六句補長 context 是否可接受，且不會讓 coverage 文字看似 Provider 臨床摘要？
6. 合成案例矩陣是否需要增加特定 coverage 組合，才能做出核准決定？
7. 「來源明示未有已知過敏紀錄」是否準確表達來源狀態，而不被解讀為跨來源、跨時間
   或由模型推定的「沒有過敏」？
8. 同時存在過敏與未有已知過敏紀錄時，固定衝突措辭是否足以避免掩蓋陽性紀錄，並
   清楚要求人工逐項核對？
9. clinical-rules.v4 的固定移除提示是否清楚表達「模型敘述未納入」，且不會被誤讀為
   原始紀錄沒有近期病程、住院、手術或出院事件？
10. 保留該節 aliases 供人工回查是否適當，或 reviewer 要求在移除整節 Provider content
    時採用其他引用呈現方式？

## Bounded reviewer 結果 — 2026-08-24

| 角色 | 當時的合成案例 1–5 | 當時的決策問題 1–6 | 當時的 wording 決定 |
| --- | --- | --- | --- |
| 臨床 reviewer | 全數 pass | 全數核准 | 核准 |
| 藥事 reviewer | 全數 pass | 全數核准 | 核准 |

## 新增 deterministic wording 的 bounded 決策表 — 2026-08-27

下表只涵蓋 2026-08-26 之後新增的三組固定文字。每一角色必須對每一組分別記錄「核准」、
「拒絕」或「待補」；不得以 2026-08-24 的歷史核准代替。`待補` 表示尚未取得該角色決策，
不是默示核准。

| 新增文字組 | 對應問題 | 臨床 reviewer | 藥事 reviewer |
| --- | --- | --- | --- |
| prompt v5 補長 context 第 5–6 句 | 5 | 待補 | 待補 |
| clinical-rules.v3 的兩句來源明示過敏固定措辭 | 7–8 | 待補 | 待補 |
| clinical-rules.v4 的固定移除提示與保留 aliases 供人工回查 | 9–10 | 待補 | 待補 |

Repository 只記錄上述角色與 bounded 結果，未收集 reviewer identity、簽章、受控系統
內容或簽核參照。任何後續文字變更都必須先更新合成 contract tests、保持完整 validator
與資料邊界，再重新執行受控人工驗證並取得新的臨床與藥事核准。本次 wording 核准不得
被解讀為整體摘要臨床驗收、正式 release 決策或可供臨床使用。
