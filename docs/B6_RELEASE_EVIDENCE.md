# B6 Engineering Gate Evidence

> **狀態說明（2026-08-24）**：本文件區分 machine-verifiable engineering gate 與
> bounded controlled manual evidence。
> AI 頁籤已透過 extension-origin iframe 接上 sealed request 與 background-only
> Provider boundary；machine-verifiable gate 只使用合成資料與 loopback request。另有
> 受控 coverage-only 與 `has-data` synthetic OpenRouter 人工觀察，以及後續固定本機
> Ollama coverage-only CLI seam，必須與本文件的自動化證據分開判讀。不得把本文件
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

The bounded category then identified non-canonical `無` wording. A stronger `clinical-summary-prompt.v2` still did not make the fixed OpenRouter model/route reliably obey that semantic rule, so the authorized implementation no longer delegates coverage prose to the Provider. Under `clinical-summary-prompt.v3`, OpenRouter receives immutable policy in a `system` message and only the sealed coverage/facts projection in a separate `user` message; its task is limited to `has-data` facts. A local deterministic coverage renderer replaces every fully uncovered section and the fixed data-gap section from the sealed coverage contract, clears Provider aliases from those replaced sections, and adds only fixed coverage context when needed to meet the unchanged 180–260 Chinese-character gate. Provider prose retained for sections with collected facts remains subject to the unchanged local negative-finding, metadata, alias, ordering, wording, field-bound, and total-length validators.

Synthetic regressions cover a lab-only snapshot whose Provider response uses non-canonical gap prose, a snapshot with no collected facts, and the fact-only outbound contract. The built MV3 loopback test additionally asserts the rendered medication/allergy and admission/procedure/discharge text in the iframe. These tests do not constitute clinical approval of the new deterministic wording; clinician and pharmacist re-review remains mandatory. The exact implemented phrases, state mapping, synthetic case matrix, and reviewer questions are collected in [`DETERMINISTIC_COVERAGE_WORDING_REVIEW.md`](DETERMINISTIC_COVERAGE_WORDING_REVIEW.md).

## Controlled manual observation — 2026-08-24

After reloading the prompt-v3/local-renderer build and using a coverage-only empty synthetic lab case, the authorized operator reported bounded PASS results for fixed-route generation across fresh sessions, strict whole-document validation, deterministic coverage semantic repeatability, and copy remaining disabled until explicit review. An initial review attempt exposed loss of the in-memory scope after an MV3 service-worker restart; build `983313a` added a same-tab, current-scope, fail-closed recovery seam, after which the operator reported review and copy eligibility passing.

The same operator reported bounded PASS results for cancellation, revision change, synthetic-patient change, logout, and tab closure. In every exercised invalidation case the prior summary and review became unavailable, copy was disabled, BYOK and outbound consent were cleared, and generation required a new user action with new session input and consent. Cancellation proves only that the local result and eligibility were discarded; it does not prove that a remote request was never received.

The operator then completed a separate non-empty synthetic lab preflight: lab coverage was `has-data` with a positive count, an opaque local source alias was present, and no identity, raw source reference, or raw row was displayed. For one explicitly authorized fixed-route request, the operator reported bounded PASS results for strict whole-document validation, inclusion of at least one collected synthetic lab fact, alias-only attribution, absence of added uncollected facts, diagnoses, or negative inference, deterministic coverage semantics for non-`has-data` families, and review/copy gating.

No summary text, Provider request or response, key, raw payload, HAR, log, screenshot, patient/session identifier, or clipboard content was collected. Fresh-session repeatability was observed only for the no-collected-facts case; the real fixed-route `has-data` path currently has one bounded successful observation. These observations do not establish `has-data` repeatability, overall clinical quality, general Provider availability, artifact approval, or release approval. Separate clinical and pharmacy approval of the deterministic coverage wording is recorded below and does not broaden these runtime observations.

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

After rebuilding and reloading the extension, the authorized operator then reported bounded PASS
for the matching real Ollama coverage-only UI generation, fixed five-section/full-validator state,
copy remaining disabled before review, and copy becoming enabled only after explicit review. No UI
content or screenshot was collected. This extends the observation to one built-extension UI retest;
it does not prove Ollama `has-data` acceptance or repeatability, general model quality, clinical
acceptance, artifact approval, or release approval.

R1 additionally exercises the real local terminal-result seam. The content runtime now passes one revision-wide batch into a closed collector that normalizes and quarantines the existing `medication`, `chinesemed`, `allergy`, `labdata`, `imaging`, `surgery`, and `discharge` source shapes, seals their coverage and local reference vault once, and renders only coverage plus opaque source aliases. The maintained product fixture covers all seven shapes and verifies that internal IDs, file handles, and image case identifiers do not enter the sealed snapshot. Encounter remains `not-collected` because the current product exposes no independent structured encounter source; HTML `patientsummary` and medication claims are deliberately not reclassified as encounter facts. This does not invoke an LLM and is local engineering evidence, not a real NHI-origin observation. R2/R3 attach an extension-origin iframe: it receives a scope only, reads public coverage/labels through the background, and can request fixed Ollama or OpenRouter generation. The iframe is the sole secret-entry surface; BYOK, explicit remote consent, optional host grants, request construction, timeout/cancellation, and strict whole-document validation are background-owned. The code and synthetic tests do not prove an installed Ollama, valid OpenRouter account/key, model availability, or successful external request. Error, cancellation, session end, revision change, and patient change clear review/copy eligibility. No visual snapshot update is part of this gate.

The synthetic runtime lifecycle tests cover the closed content-to-background capability path: content emits only lifecycle messages after its existing terminal data-fetch event, ends the current scope on patient-switch and page-exit events, and the background clears the matching scope when Chrome reports tab removal. These tests contain no patient payload, credentials, Provider request, screenshot, or session value from a browser.

## Manual gates required before a clinical or production release

These checks cannot be truthfully performed by repository automation and remain the release owner's responsibility:

- Qualified clinical and pharmacy reviewers approved the deterministic coverage wording matrix on 2026-08-24. Broader synthetic-summary clinical acceptance remains a separate pending gate.
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
compatibility version. `has-data` fixed-route evidence has only one bounded successful observation,
overall clinical acceptance is incomplete, real Ollama evidence is unavailable, and the formal
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

The later 2026-08-25 coverage-only Ollama CLI evidence narrows one Provider gap but does not change
the release owner's artifact rejection, pending provenance decision, or formal publication rejection.

Passing `verify:release` is evidence of code and artifact hygiene, not a clinical validation, deployment approval, or provider end-to-end certification.
