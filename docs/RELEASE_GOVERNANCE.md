# NIHCloudAI Release Governance

狀態日期：2026-09-02  
Canonical repository：`ShowmarkHsu/NIHCloudAI`

## 版本身份

- NIHCloudAI 使用 SemVer 2.0；目前產品版本為 `0.2.0`。
- 候選版本格式為 `0.2.0-rc.N`，Git tag 為 `v0.2.0-rc.N`。
- 正式版本 tag 為 `v0.2.0`；既有 `v0.1.0` 屬同一產品 lineage，不得重用、移動或刪除。
- Chrome `manifest.version` 是獨立、單調遞增且符合 Chrome component 規則的 build version；目前為 `26.702.2`。
- `manifest.version_name` 顯示產品版本，目前為 `NIHCloudAI 0.2.0`。
- 上游 `26.0702.1` 僅作為 provenance，不是 NIHCloudAI 產品版本。

## Release gate

只有 release owner 可建立 release tag。建立前必須同時符合：

1. 來源位於 canonical `main`，工作樹乾淨，且 commit 已完成 review。
2. `npm ci`、`npm run verify`、`npm run test:visual` 全部通過；canonical `main` 的 required checks 固定為 PR workflow 的 `verify` 與 `visual`，不得以無關 check 代替。
3. Developer-mode install/update/remove 與 Provider lifecycle 已依受控 runbook 完成。
4. 當前 prompt/schema/rules/model 組合已有整體臨床與藥事 acceptance。
5. Ollama/OpenRouter configuration、clinical acceptance 與 OpenRouter metadata 的五個 evidence SHA-256 已備妥。
6. Artifact、Provenance、Publication gate 均由 release owner 核准。

未滿足任一條件時，只能進行受控開發驗證，不得建立 release tag 或 publication。

## Tag 與 artifact 流程

1. Release owner 從核准的 `main` commit 建立 annotated、GPG 或 SSH signed tag。
2. RC 使用 `v0.2.0-rc.N` 並發布為 GitHub prerelease；只有 stable tag 可設為 latest。
3. Release workflow 必須從該 tag ref 手動啟動，且輸入版本必須與 tag 完全相同。
4. Tag、workflow 輸入、`package.json` 版本與 Chrome `version_name` 必須完全一致；建立 RC commit 前先把 source metadata 切換為該 RC，例如 `0.2.0-rc.1`／`NIHCloudAI 0.2.0-rc.1`。
5. Workflow 驗證 tag 是 annotated 且 GitHub signature verification 為通過，不在 CI 中建立或移動 tag。
6. Workflow 驗證 tag commit 已存在 canonical `main`。Stable 使用一個直接接在已發布、已核准 RC commit 後的 promotion commit；該 commit 只可把 `package.json`、`package-lock.json` 與 `public/manifest.json` 的 RC 身份切換為 stable，不得改動其他檔案。
7. Verify/package job 僅有 `contents: read` 且不保存 checkout credential；具有 `contents: write` 的 publish job 不 checkout、不安裝 dependency，也不執行 repository code。
8. Workflow 以 `scripts/create-release-artifact.mjs` 產生：
   - `nihcloudai-extension.zip`
   - `release-manifest.json`
   - `SHA256SUMS`
9. Builder 必須在乾淨 commit 上完成兩次 byte-identical build；不得用一般 `zip` 取代，且 source metadata 不一致時必須 fail closed。
10. Workflow 只建立 draft release，拒絕既有 tag release、禁止覆寫 assets；release owner 驗證 hashes 與 evidence binding 後才能手動發布。

Canonical repository 必須預先保護 `main` 並以 strict 模式要求 `verify` 與 `visual` checks，建立受保護的 `release` GitHub Environment 並設定 required reviewer；本 repository 目前只有 release owner `ShowmarkHsu`（GitHub user ID `12873164`），因此明確允許 self-review。tag ruleset 必須限制只有授權 release owner `ShowmarkHsu` 可 bypass `v*` 的 creation／update／deletion restrictions，tag 本身仍須通過 GitHub signature verification，且 immutable releases 必須啟用。`release` environment 必須保護 `verify-and-package` job，使 required reviewer 在 repository code、正式 artifact 或 Actions artifact 被建立前，先核對已核准的五件 evidence object、不可變 locator、candidate commit 與 digest ledger；空白、`PENDING` 或無法定位的 digest 不得核准。Release workflow 使用只供 governance read 的 `RELEASE_GOVERNANCE_TOKEN`，在建置任何正式 artifact 前以 API fail closed 驗證 main protection／上述兩個 required checks、environment reviewer、active tag ruleset 與 immutable releases；token 缺失、權限不足、API 失敗或任一設定不符時停止。若上述設定未完成或無法確認，Publication gate 維持 blocked。

## RC 升版

- 同一產品內容的修正依序使用 `rc.1`、`rc.2`……；每個 RC 都是新 tag、新 artifact 與新 evidence binding。
- 若變更使既有臨床或 Provider evidence 失效，必須重跑相應 gate，不得沿用舊 hash。
- Stable `0.2.0` 只能由最後一個已核准且已發布的 RC promotion：stable commit 必須是該 RC commit 的直接 child，且只修改三個版本身份檔。因 source commit 與 artifact identity 仍會改變，必須重跑工程 gates，並重新綁定或重作所有要求 candidate commit 一致的 evidence；不得把 RC digest 直接冒充 stable digest。

## 撤回與 rollback

- 已發布 tag 永不覆寫、移動或刪除；撤回版本標示 withdrawn/yanked，保留 tag、artifact hash 與原因。
- 程式回退使用 revert commit，不使用 force-push 或 history rewrite。
- 已發布 stable 的修正使用更高 patch，例如 `0.2.1`；Chrome rollback 也必須使用高於 `26.702.2` 的合法 build version。
- 發生資料邊界、病人隔離、Provider routing 或臨床內容風險時，立即停止 publication／pilot，依 runbook 清除 session state 並回復至最近核准版本。

## Canonical history blocker

截至 2026-09-02，canonical `main`（standalone `v0.1.0`）與目前 integration branch 沒有共同祖先。完成 history reconciliation 前不得直接 push 或建立一般 PR。預設建議從 canonical `main` 建立新 integration branch，再挑選或重做必要變更；若改採 unrelated-history bridge merge，必須由 release owner 另行核准並接受大型 reconciliation review。
