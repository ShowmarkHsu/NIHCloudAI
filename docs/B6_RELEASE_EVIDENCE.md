# B6 Engineering Gate Evidence

> **狀態說明（2026-08-26）**：本文件區分 machine-verifiable engineering gate 與
> bounded controlled manual evidence。
> AI 頁籤已透過 extension-origin iframe 接上 sealed request 與 background-only
> Provider boundary；machine-verifiable gate 只使用合成資料與 loopback request。另有
> 受控 coverage-only 與 `has-data` synthetic OpenRouter 人工觀察，以及後續固定本機
> Ollama coverage-only／lab `has-data` CLI seam 與隔離 built-MV3 UI seam，必須與本文件的自動化證據分開判讀。不得把本文件
> 解讀為一般 Provider 可用、release ready 或臨床驗收完成。完整缺口與復原順序見
> [`PROJECT_RECOVERY_PLAN.md`](PROJECT_RECOVERY_PLAN.md)。

This branch's B6 deliverable is a reproducible engineering gate. It proves only the build-time boundaries that can be checked without accessing a real patient, a Provider account, or a clinical reviewer.

Run the complete gate from the repository root:

```powershell
npm run verify
```

The command verifies the frozen upstream baseline, AI contract suite, TypeScript, lint scope, legacy characterization suite, production build, generated `dist` directory, the synthetic browser suite, and a browser-loaded MV3 iframe that fails closed without a current sealed scope. It also copies `dist` to an isolated temporary artifact, pre-grants only the fixed OpenRouter host in that copy, rewrites only the fixed endpoint to a loopback synthetic responder, and verifies that the built MV3 background completes the transport and strict whole-document validation without sending data externally. The built-extension regression terminates the MV3 service worker after generation and verifies that review recovers only the current same-tab sealed scope while copy remains disabled until review. `npm run verify:release` remains the non-browser subset used by CI or constrained environments.

The generated-artifact check fails when any of the following occurs:

- `manifest.json` has a permission other than `storage` and `clipboardWrite`.
- `manifest.json` has a host permission other than the existing fixed NHI Cloud or drug-image host.
- `manifest.json` has an optional host permission other than the fixed Ollama loopback or OpenRouter host.
- A source map or source-map reference is shipped.
- A shipped text artifact contains an API-key or bearer-token shaped value.

Provider execution is background-only. The code fixes Ollama to the loopback endpoint/model and fixes the OpenRouter request route/model; OpenRouter has only an optional host permission and cannot send until the exact current revision has an in-memory BYOK value, explicit outbound-data consent, and the optional host grant. Both Provider requests now carry the same strict closed JSON schema; Ollama also fixes `temperature: 0` and `seed: 0`, while OpenRouter additionally fixes `require_parameters: true`. The local Zod contract remains authoritative and rejects invalid section order, wording, character limits, or source aliases without exposing response content. The MV3 regression additionally verifies that the runtime calls worker-global `fetch` with its required receiver instead of passing it as an unbound function. The release check rejects source maps and secret-shaped values in `dist`; neither that check nor the loopback transport test is evidence of a real Provider connection, account, model availability, or route acceptance.

After a controlled synthetic OpenRouter attempt reached the local whole-document gate, the previous single `validation-failed` state was split into bounded fail-closed categories: missing output, truncated output, JSON structure, source alias, content policy, and Chinese-character count. A subsequent controlled attempt reached the content-policy category, which is further divided into forbidden metadata/formatting, missing-data-as-negative wording, fixed data-gap wording, and per-field bounds. These categories contain no response text, request text, aliases, counts, HTTP details, Zod issues, or Provider payload. They are diagnostic evidence only; the later coverage-only successful observations below do not extend them into `has-data` or clinical acceptance evidence.

The bounded category then identified non-canonical `無` wording. A stronger `clinical-summary-prompt.v2` still did not make the fixed OpenRouter model/route reliably obey that semantic rule, so the authorized implementation no longer delegates coverage prose to the Provider. Under `clinical-summary-prompt.v3`, OpenRouter receives immutable policy in a `system` message and only the sealed coverage/facts projection in a separate `user` message; its task is limited to `has-data` facts. A local deterministic coverage renderer replaces every fully uncovered section and the fixed data-gap section from the sealed coverage contract, clears Provider aliases from those replaced sections, and adds only fixed coverage context when needed to meet the unchanged 180–260 Chinese-character gate. `clinical-summary-prompt.v4` additionally makes the local renderer, rather than Provider prose, responsible for the post-merge minimum length and separates clinical content from structured source attribution. The local validator canonicalizes only a redundant alias token that is both declared by the same section and known to the sealed request; undeclared or unknown aliases and every other metadata, negative-finding, ordering, wording, field-bound, and total-length failure remain fail closed.

Synthetic regressions cover a lab-only snapshot whose Provider response uses non-canonical gap prose, a snapshot with no collected facts, and the fact-only outbound contract. The built MV3 loopback test additionally asserts the rendered medication/allergy and admission/procedure/discharge text in the iframe. These tests do not constitute clinical approval of the new deterministic wording; clinician and pharmacist re-review remains mandatory. The exact implemented phrases, state mapping, synthetic case matrix, and reviewer questions are collected in [`DETERMINISTIC_COVERAGE_WORDING_REVIEW.md`](DETERMINISTIC_COVERAGE_WORDING_REVIEW.md).

## Controlled manual observation — 2026-08-24

After reloading the prompt-v3/local-renderer build and using a coverage-only empty synthetic lab case, the authorized operator reported bounded PASS results for fixed-route generation across fresh sessions, strict whole-document validation, deterministic coverage semantic repeatability, and copy remaining disabled until explicit review. An initial review attempt exposed loss of the in-memory scope after an MV3 service-worker restart; build `983313a` added a same-tab, current-scope, fail-closed recovery seam, after which the operator reported review and copy eligibility passing.

The same operator reported bounded PASS results for cancellation, revision change, synthetic-patient change, logout, and tab closure. In every exercised invalidation case the prior summary and review became unavailable, copy was disabled, BYOK and outbound consent were cleared, and generation required a new user action with new session input and consent. Cancellation proves only that the local result and eligibility were discarded; it does not prove that a remote request was never received.

The operator then completed a separate non-empty synthetic lab preflight: lab coverage was `has-data` with a positive count, an opaque local source alias was present, and no identity, raw source reference, or raw row was displayed. For one explicitly authorized fixed-route request, the operator reported bounded PASS results for strict whole-document validation, inclusion of at least one collected synthetic lab fact, alias-only attribution, absence of added uncollected facts, diagnoses, or negative inference, deterministic coverage semantics for non-`has-data` families, and review/copy gating.

No summary text, Provider request or response, key, raw payload, HAR, log, screenshot, patient/session identifier, or clipboard content was collected. Fresh-session repeatability was observed only for the no-collected-facts OpenRouter case; the real fixed-route OpenRouter `has-data` path currently has one bounded successful observation. These OpenRouter observations do not establish OpenRouter `has-data` repeatability, overall clinical quality, general Provider availability, artifact approval, or release approval. Separate clinical and pharmacy approval of the deterministic coverage wording is recorded below and does not broaden these runtime observations.

The user subsequently reported that the security/privacy owner and the hospital/environment owner approved their respective gates. Clinical and pharmacy reviewers then independently reported all five wording cases passing, all six reviewer questions approved, and a final approval of the current deterministic coverage wording. This repository records only those bounded approval states; no approver identity, signature reference, account detail, environment identifier, or controlled-system link was collected. Overall clinical acceptance and the release-owner decision remain pending.

## Controlled local Ollama CLI observation — 2026-08-25

An explicitly authorized local-only preflight confirmed the fixed loopback service and pinned
`gemma4:e2b-it-qat` model/digest were available. The first fixed boundary attempt reproduced the
operator's bounded `validation-structure-failed` UI state without exposing Provider output. The
Ollama request had not carried the existing fixed JSON schema; a red boundary regression captured
that omission before the request was changed to include the schema and deterministic sampling.

The same real fixed coverage-only synthetic seam then completed twice through the unchanged full
validator and deterministic coverage renderer. The test records only PASS and the final bounded
`completed` state; it does not print or retain request/response bodies, summary text, source aliases,
session identifiers, logs, HAR, screenshots, or clipboard content. Exploratory `has-data` runs moved
past structure but were rejected by the unchanged semantic gates, including negative-wording,
metadata, and field-bound categories. Therefore this evidence proves only repeatable local
coverage-only CLI completion.

On 2026-08-26, a red-capable lab `has-data` regression at the same real background boundary
reproduced `validation-content-negative-none-word-failed` twice. Removing the conflicting Provider
minimum-length responsibility moved the bounded result to `validation-content-metadata-failed`;
diagnostic categories containing no response text then established that the fixed model was
repeating a section-declared source alias inside clinical content. Prompt-only, native `system`
separation, unsupported schema-pattern, and one-round self-repair probes did not provide a stable
solution and were not retained. The final prompt-v4 validator instead canonicalizes only redundant,
same-section, sealed-request-known aliases into the structured source field before applying the
unchanged complete validator. An undeclared alias remains a regression failure.

The final fixed lab `has-data` seam then completed in three fresh test processes through the strict
schema, alias mapping, negative-finding, metadata, field-bound, total-length, and deterministic
coverage gates. Each run made one Provider request and recorded only PASS plus the bounded
`completed` state; no request, response, summary, alias value, clinical fact, session value, log,
HAR, screenshot, or clipboard content was retained. This is repeatability evidence for one sealed
synthetic lab fact on the pinned local Ollama model. This CLI evidence alone is not built-extension `has-data` UI evidence,
multi-family or general model quality evidence, clinical acceptance, artifact approval, or release
approval.

The same day, an isolated built-MV3 controlled path loaded a temporary copy of `dist` into a fresh
Chromium profile and injected one sealed synthetic lab fact through the real content runtime and
extension iframe. A first direct request from the temporary random extension origin stopped at the
bounded Provider HTTP rejection state before validation. No response body was read or retained, so
this observation does not identify or prove a specific Ollama origin-policy cause.

The retained controlled harness leaves production `dist` unchanged and rewrites only its temporary
copy to use an ephemeral localhost in-memory bridge. The temporary manifest pre-grants only the
fixed Ollama loopback and ephemeral bridge origins; the bridge forwards the synthetic request to
the fixed `127.0.0.1:11434` Ollama endpoint without logging or retaining request or response content.
Three fresh Chromium tabs/data sessions then each reached the bounded full-validation success state,
kept copy disabled before review, and enabled copy only after explicit review. The harness did not
read summary fields, aliases, clinical facts, clipboard content, or screenshots, and removed the
temporary profile and artifact afterward.

This proves repeatable built-extension UI/background/real-Ollama/full-validator and review/copy
behavior for the isolated bridged synthetic lab case. It does not prove direct-origin compatibility
for an installed extension ID, optional-permission UX, NHI-origin real-data summary behavior,
multi-family or general model quality, clinical acceptance, artifact approval, or release approval.

After rebuilding and reloading the extension, the authorized operator then reported bounded PASS
for the matching real Ollama coverage-only UI generation, fixed five-section/full-validator state,
copy remaining disabled before review, and copy becoming enabled only after explicit review. No UI
content or screenshot was collected. This extends the observation to one built-extension UI retest;
that earlier UI observation alone does not prove installed-extension direct-origin Ollama `has-data` acceptance or repeatability, general model quality, clinical
acceptance, artifact approval, or release approval.

Later on 2026-08-26, the installed-extension direct-origin full-data attempt reported the bounded
`validation-structure-failed` state. A red-capable real-Ollama test using the maintained full product
fixture reproduced that state without retaining Provider output. Bounded diagnostics established
that Ollama had ended with `done_reason=length`; the boundary had ignored that envelope state and
passed a partial string to JSON parsing. Prompt v5 now classifies the Ollama length stop as
`provider-output-truncated`, pins `num_ctx=32768`, `num_predict=1024`, and `think=false`, and sends
all facts in per-family column/row tables. A non-gated regression verifies that all 183 sealed fixture
records and aliases remain represented while the prompt shrinks from 43,300 to 21,443 characters.
The Provider schema also bounds each section to 30–65 characters and 20 aliases. Two deterministic
local review-context sentences were added so concise but valid Provider facts still reach the
unchanged 180–260 Chinese-character gate.

The maintained full product fixture then completed through the entire local validator in three fresh
test processes in 165.5 seconds after three other controlled cases in the same process, then 51.3 and
51.0 seconds in isolated runs. The tests retained no request, response, summary,
alias value, clinical content, session value, log, HAR, screenshot, or clipboard content. This proves
only pinned-local-Ollama multi-family CLI repeatability for the maintained fixture. The two new local
sentences require renewed clinical and pharmacy wording approval; installed-extension direct-origin
v5 behavior, real-patient summary quality, artifact approval, and release approval remain pending.

The subsequent installed-extension direct-origin attempt reported the bounded
`validation-content-negative-none-word-failed` state. A red-capable real-Ollama regression using a
synthetic source-stated `no-known-allergy` record reproduced it without retaining Provider output.
The previous negative-finding gate rejected every non-coverage use of the character `無`, so it
could not distinguish source-stated allergy absence from an unsupported model inference.
`clinical-rules.v3` now permits local canonicalization only when sealed allergy evidence contains
`no-known-allergy`, only in the review-focus or medication/allergy section, and only for an allergy
clause. The background restores only the supporting sealed aliases. Positive-only allergy evidence,
an unrelated none-word clause, another section, or any remaining none-word continues to fail closed.
When positive and no-known evidence coexist, a separate fixed conflict warning retains both sets of
aliases and requires item-by-item human review.

The source-stated no-known-allergy case, paired with a synthetic medication fact to represent the
full-data medication/allergy section, then completed in three fresh processes in 25.8, 22.7, and
22.7 seconds. An allergy-only attempt remained fail closed when the model combined unsupported
no-medication wording with the supported allergy state. The maintained full product fixture also
completed again under the final rule in 177.8 seconds. Only bounded completion status and duration
were retained. The two new fixed allergy phrases are
explicitly pending clinical and pharmacy review. The installed-extension direct-origin retest of
that rebuilt artifact still reported the generic `validation-content-negative-none-word-failed`
state. To continue without requesting or retaining summary content, the validator now subdivides
that state into five bounded causes: outside the two supported sections, multiple none-word uses in
one section, unrelated to allergy, unsupported by sealed allergy evidence, or outside the controlled
allergy-phrase window. The result carries no section text, alias, character count, or Provider
payload and does not relax fail-closed validation. Installed-extension retesting of this diagnostic
build remains pending. These results do not establish clinical meaning, general model quality,
artifact approval, or release approval.

The installed-extension retest of the first bounded diagnostic build then reported only the
outside-supported-sections category. The next diagnostic layer therefore distinguishes the fixed
recent-course/tests, admission/procedure/discharge, and data-gap sections, plus one boolean stating
whether an alias cited by that section maps to a sealed source record that itself contains a
source-stated none-word. It returns no source value, summary phrase, alias, count, or Provider
payload and still rejects the summary. Installed-extension retesting of this section/source-support
diagnostic build remains pending.

R1 additionally exercises the real local terminal-result seam. The content runtime passes one revision-wide batch into a closed collector that normalizes and quarantines the existing `medication`, `chinesemed`, `allergy`, `labdata`, `imaging`, `surgery`, and `discharge` source shapes, seals their coverage and local reference vault once, and renders only coverage plus opaque source aliases. Encounter is constructed only from explicit claim-header date, facility, visit type, and source diagnosis fields already present on both western and Chinese medication results; records are deduplicated, missing source diagnoses remain `null`, and any unavailable claim source prevents partial encounter records from being sealed. HTML `patientsummary` and medication names are not used. The maintained product fixture covers all eight Phase 1 families and verifies that internal IDs, file handles, and image case identifiers do not enter the sealed snapshot. An authorized operator first reported that the pre-encounter build displayed the seven direct-source coverage results on the real NHI-origin page, then reported bounded PASS for claims encounter coverage after loading the new build. No screenshot, count, clinical content, or identity was collected. The eight-family collection/display seam therefore has bounded NHI-origin manual evidence, but this does not invoke an LLM and remains engineering evidence rather than summary-quality or release approval. R2/R3 attach an extension-origin iframe: it receives a scope only, reads public coverage/labels through the background, and can request fixed Ollama or OpenRouter generation. The iframe is the sole secret-entry surface; BYOK, explicit remote consent, optional host grants, request construction, timeout/cancellation, and strict whole-document validation are background-owned. The code and synthetic tests do not prove an installed Ollama, valid OpenRouter account/key, model availability, or successful external request. Error, cancellation, session end, revision change, and patient change clear review/copy eligibility. No visual snapshot update is part of this gate.

The synthetic runtime lifecycle tests cover the closed content-to-background capability path: content emits only lifecycle messages after its existing terminal data-fetch event, ends the current scope on patient-switch and page-exit events, and the background clears the matching scope when Chrome reports tab removal. These tests contain no patient payload, credentials, Provider request, screenshot, or session value from a browser.

## Manual gates required before a clinical or production release

These checks cannot be truthfully performed by repository automation and remain the release owner's responsibility:

- Qualified clinical and pharmacy reviewers approved the then-current deterministic coverage wording matrix on 2026-08-24. That historical approval does not cover prompt-v5 context sentences 5–6 or the two `clinical-rules.v3` source-stated allergy phrases; those additions and broader synthetic-summary clinical acceptance remain pending gates.
- An authorized operator verifies the intended Chrome build against approved test patients only; no real data, screenshot, request body, key, or session value may enter this repository.
- Before any remote Provider connection, the owner records the exact endpoint/model/version, asks for outbound-data consent for that session, confirms the optional host grant, validates session-only secret handling, and re-runs the gate with the least-privilege permission policy.
- The release owner completes the developer-mode install, update, removal, Provider and data-handling checklist in [`CONTROLLED_MANUAL_VALIDATION_RUNBOOK.md`](CONTROLLED_MANUAL_VALIDATION_RUNBOOK.md) (with [`DEVELOPER_MODE_DISTRIBUTION.md`](DEVELOPER_MODE_DISTRIBUTION.md) as the installation summary).

Security/privacy and hospital/environment approval, plus clinical and pharmacy approval of deterministic coverage wording, were reported on 2026-08-24 without repository-held signature references. Those approvals do not substitute for pending overall clinical acceptance or artifact provenance, and they do not override the release-owner rejection recorded below.

## Release owner decision — 2026-08-24

The release-owner audit was performed against source commit `6e29265`. A clean offline `npm ci`
completed with zero reported vulnerabilities; `npm run verify` passed; the formal visual run passed
45 cases with one expected conditional skip and no golden updates; and 23 generated `dist` artifacts
were byte-identical across consecutive builds. The fixed upstream baseline, license hash, local remote
topology, minimal MV3 permissions, optional origins, source-map prohibition, and secret-shaped-value
gate also passed.

The repository nevertheless has no NIHCloudAI release identity or independent SemVer, annotated
release tag, immutable release ZIP, instantiated release manifest, artifact hash record, or complete
provider/clinical evidence hashes. The current extension version `26.0702.1` remains an upstream-fork
compatibility version. At the time of that decision, `has-data` fixed-route evidence had only one bounded successful observation,
overall clinical acceptance was incomplete, real Ollama evidence was unavailable, and the formal
developer-mode install/update/removal record is incomplete.

The authorized release owner reported the following bounded decision:

| Decision area | Result |
| --- | --- |
| Artifact | Rejected; immutable artifact and instantiated manifest required |
| Provenance | Pending |
| Publication | Formal release rejected; continued controlled development validation allowed |

No release-owner identity, signature, controlled-system content, or approval reference was collected.
Permission to continue controlled development validation is not deployment approval, clinical-use
approval, a standing authorization for external data transfer, or permission to push this branch.

The later 2026-08-25 coverage-only and 2026-08-26 lab `has-data` Ollama CLI/isolated-UI evidence narrow Provider gaps but do not change
the release owner's artifact rejection, pending provenance decision, or formal publication rejection.

Passing `verify:release` is evidence of code and artifact hygiene, not a clinical validation, deployment approval, or provider end-to-end certification.
