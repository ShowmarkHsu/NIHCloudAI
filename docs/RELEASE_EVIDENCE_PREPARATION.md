# Release evidence 封裝與雜湊準備（非 PHI）

狀態：本文件只定義 `0.2.0` release workflow 所需的五個 evidence object 與
交付格式。空白範本、歷史觀察、自動化測試結果及本文件本身都不是 P2/P3 驗收
證據，不得為了取得雜湊而填入推測結果或代替授權簽核。

人工執行仍須遵循[受控人工驗證 Runbook](./CONTROLLED_MANUAL_VALIDATION_RUNBOOK.md)
與[證據及簽核紀錄](./CONTROLLED_VALIDATION_EVIDENCE_TEMPLATE.md)。五個完成物應保存
在核准且可鎖定版本的受控系統；repository 只記錄不含敏感資訊的不可變 locator、
版本及 SHA-256，不保存 PHI、API key、request／response、raw payload、HAR、console
匯出、clipboard 或病人畫面。

## 五個必要 evidence objects

每個 object 必須是獨立、不可變的 UTF-8 檔案或受控系統匯出物。若內容或核准狀態
改變，建立新版本並重新計算雜湊；不得覆寫既有 object 後沿用舊 digest。

| Object ID | 必要內容 | 必要核准狀態 | Workflow input |
| --- | --- | --- | --- |
| `ollama-configuration` | 已審查 commit、extension／Chrome 版本、固定 endpoint、model、model digest、timeout、exact optional permission；不得包含本機帳號或環境細節 | 授權操作者、資安／隱私、院方／環境 owner | `ollama_configuration_sha256` |
| `ollama-clinical-acceptance` | 合成 case-set 與 prompt/schema/rules/model 版本、適用 runbook 項目的 bounded 結果、整體臨床與藥事決策；不得包含摘要文字或來源 aliases | 臨床與藥事 reviewer；狀態必須明確為核准或拒絕 | `ollama_clinical_acceptance_sha256` |
| `openrouter-configuration` | 已審查 commit、extension／Chrome 版本、固定 endpoint/model/route、sampling、no-fallback、ZDR/data-policy、session-only BYOK/consent 與 exact permission；不得包含 key | 授權操作者、資安／隱私、院方／環境 owner | `openrouter_configuration_sha256` |
| `openrouter-clinical-acceptance` | 合成 case-set 與 prompt/schema/rules/model 版本、適用 runbook 項目的 bounded 結果、整體臨床與藥事決策；不得包含 Provider output | 臨床與藥事 reviewer；狀態必須明確為核准或拒絕 | `openrouter_clinical_acceptance_sha256` |
| `openrouter-metadata` | 執行時間窗、固定 endpoint/model/route、可驗證的 Provider metadata／policy 參照與 bounded route 結果；不得包含 request ID、帳號、key、payload 或用量明細 | 授權操作者與 release owner 確認 metadata 與候選設定一致 | `openrouter_metadata_sha256` |

Configuration object 應與 `release/manifest.schema.json` 的固定 provider contract 一致。
Clinical acceptance object 必須針對同一候選 commit 與同一組
`clinical-projection.v1`、`clinical-summary-prompt.v7`、`clinical-summary.v1`、
`clinical-rules.v4`、`clinical-case-set.v1`；逐組 wording 核准不能代替整體 acceptance。

## 每個 object 的最小封面

以下欄位可以複製到各受控 object。不得將空白或 `PENDING` object 計算後交給
release workflow。

```text
object_id: <上述五種之一>
object_version: <受控系統的不可變版本>
status: PENDING | APPROVED | REJECTED
candidate_commit: <40 位小寫 Git SHA>
product_version: 0.2.0
chrome_build_version: 26.702.2
executed_at: <ISO 8601，含時區>
controlled_case_set: clinical-case-set.v1
runbook_revision: <本文件所在的 Git commit 或受控版本>
review_decision_reference: <不含個資的不可變簽核 locator>
```

Configuration object 可將不適用的 `controlled_case_set` 標成 `N/A`。若受控系統
不能提供不可變版本或 locator，P3.2 維持 `BLOCKED`，不得以一般可編輯連結取代。

## SHA-256 計算與交叉核對

先從受控系統匯出最終、已核准版本到受控工作目錄，再以至少兩個獨立實作核對同一
檔案。PowerShell 可使用：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '<evidence-file>'
certutil -hashfile '<evidence-file>' SHA256
```

兩者必須得到相同的 64 位 hex。Workflow input 使用小寫且加上 `sha256:` 前綴；
雜湊不一致、檔案仍可變、任何 reviewer 為待補，或 object 與候選 commit／contract
不一致時，不得填入 workflow。

## Release-owner digest ledger

只有五個 object 都已完成且可定位後才填寫。此表可以記在受控 release record；
在 repository 更新時只能保留非敏感 locator。

| Object ID | Immutable locator | Object version | Candidate commit | Decision | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `ollama-configuration` | PENDING | PENDING | PENDING | PENDING | PENDING |
| `ollama-clinical-acceptance` | PENDING | PENDING | PENDING | PENDING | PENDING |
| `openrouter-configuration` | PENDING | PENDING | PENDING | PENDING | PENDING |
| `openrouter-clinical-acceptance` | PENDING | PENDING | PENDING | PENDING | PENDING |
| `openrouter-metadata` | PENDING | PENDING | PENDING | PENDING | PENDING |

Release owner 必須逐列確認 locator 可讀且不可變、object 與候選 commit 相同、核准
角色完整、兩種 SHA-256 實作一致，才可把 digest 傳入 workflow。完成五個雜湊仍不會
自動解除 Artifact、Provenance 或 Publication gate，也不授權建立 tag、artifact 或
release。

Release workflow 不會也不應從 repository 讀取受控 evidence object 內容；五個 digest
本身只能證明內容識別，不能證明 locator、狀態或簽核。受保護的 `release` environment
因此必須放在 `verify-and-package` job：required reviewer 應在任何正式 artifact 建立前
以受控系統逐列核對上表，並拒絕空白、`PENDING`、不可定位、candidate commit 不符或
簽核未完成的輸入。Environment approval 是必要的人工作業邊界，不會取代 P2/P3 或
release-owner 的最終 Artifact／Provenance／Publication 決策。
