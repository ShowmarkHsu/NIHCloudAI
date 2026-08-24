# B6 Engineering Gate Evidence

> **狀態說明（2026-08-21）**：本文件只記錄 machine-verifiable engineering gate。
> AI 頁籤已透過 extension-origin iframe 接上 sealed request 與 background-only
> Provider boundary；但只有合成資料和未連線的固定 request 被驗證。不得把本文件
> 解讀為 Provider 實際可用、release ready 或臨床驗收完成。完整缺口與復原順序見
> [`PROJECT_RECOVERY_PLAN.md`](PROJECT_RECOVERY_PLAN.md)。

This branch's B6 deliverable is a reproducible engineering gate. It proves only the build-time boundaries that can be checked without accessing a real patient, a Provider account, or a clinical reviewer.

Run the complete gate from the repository root:

```powershell
npm run verify
```

The command verifies the frozen upstream baseline, AI contract suite, TypeScript, lint scope, legacy characterization suite, production build, generated `dist` directory, the synthetic browser suite, and a browser-loaded MV3 iframe that fails closed without a current sealed scope. It also copies `dist` to an isolated temporary artifact, pre-grants only the fixed OpenRouter host in that copy, rewrites only the fixed endpoint to a loopback synthetic responder, and verifies that the built MV3 background completes the transport and strict whole-document validation without sending data externally. `npm run verify:release` remains the non-browser subset used by CI or constrained environments.

The generated-artifact check fails when any of the following occurs:

- `manifest.json` has a permission other than `storage` and `clipboardWrite`.
- `manifest.json` has a host permission other than the existing fixed NHI Cloud or drug-image host.
- `manifest.json` has an optional host permission other than the fixed Ollama loopback or OpenRouter host.
- A source map or source-map reference is shipped.
- A shipped text artifact contains an API-key or bearer-token shaped value.

Provider execution is background-only. The code fixes Ollama to the loopback endpoint/model and fixes the OpenRouter request route/model; OpenRouter has only an optional host permission and cannot send until the exact current revision has an in-memory BYOK value, explicit outbound-data consent, and the optional host grant. The fixed OpenRouter request includes a strict closed JSON schema plus `require_parameters: true`; the local Zod contract remains authoritative and rejects invalid section order, wording, character limits, or source aliases without exposing response content. The MV3 regression additionally verifies that the runtime calls worker-global `fetch` with its required receiver instead of passing it as an unbound function. The release check rejects source maps and secret-shaped values in `dist`; neither that check nor the loopback transport test is evidence of a real Provider connection, account, model availability, or route acceptance.

After a controlled synthetic OpenRouter attempt reached the local whole-document gate, the previous single `validation-failed` state was split into bounded fail-closed categories: missing output, truncated output, JSON structure, source alias, content policy, and Chinese-character count. A subsequent controlled attempt reached the content-policy category, which is further divided into forbidden metadata/formatting, missing-data-as-negative wording, fixed data-gap wording, and per-field bounds. These categories contain no response text, request text, aliases, counts, HTTP details, Zod issues, or Provider payload. They are diagnostic evidence only; a real successful completion is still required before Provider end-to-end acceptance.

The bounded category then identified missing-data-as-negative wording. The fixed prompt contract is now `clinical-summary-prompt.v2`: OpenRouter receives immutable policy in a `system` message and only the sealed coverage/facts projection in a separate `user` message. The sealed projection includes a closed machine-readable coverage mapping (`has-data` → facts only, `confirmed-empty` → the fixed unavailable-data wording, every other terminal state → the fixed data-gap wording), and the structured-output content property repeats the same policy as a description. A synthetic Provider regression returns the prohibited negative wording unless all three controls are present. A controlled retry still reached the negative-wording gate, so that bounded state is now divided into the fixed token classes `未發現`, `正常`, and other non-canonical uses of `無`; no surrounding response content or location is returned. The local negative-finding validator remains unchanged and authoritative.

R1 additionally exercises one real local product seam: a terminal upstream lab result is normalized and quarantined inside a closed module, sealed with coverage and a local reference vault, accepted by the background store, and rendered in the existing AI tab as coverage plus opaque source aliases. It does not invoke an LLM. R2/R3 attach an extension-origin iframe: it receives a scope only, reads public coverage/labels through the background, and can request fixed Ollama or OpenRouter generation. The iframe is the sole secret-entry surface; BYOK, explicit remote consent, optional host grants, request construction, timeout/cancellation, and strict whole-document validation are background-owned. The code and synthetic tests do not prove an installed Ollama, valid OpenRouter account/key, model availability, or successful external request. Error, cancellation, session end, revision change, and patient change clear review/copy eligibility. No visual snapshot update is part of this gate.

The synthetic runtime lifecycle tests cover the closed content-to-background capability path: content emits only lifecycle messages after its existing terminal data-fetch event, ends the current scope on patient-switch and page-exit events, and the background clears the matching scope when Chrome reports tab removal. These tests contain no patient payload, credentials, Provider request, screenshot, or session value from a browser.

## Manual gates required before a clinical or production release

These checks cannot be truthfully performed by repository automation and remain the release owner's responsibility:

- A qualified clinician and pharmacist review and sign off on the synthetic clinical acceptance cases.
- An authorized operator verifies the intended Chrome build against approved test patients only; no real data, screenshot, request body, key, or session value may enter this repository.
- Before any remote Provider connection, the owner records the exact endpoint/model/version, asks for outbound-data consent for that session, confirms the optional host grant, validates session-only secret handling, and re-runs the gate with the least-privilege permission policy.
- The release owner completes the developer-mode install, update, removal, Provider and data-handling checklist in [`CONTROLLED_MANUAL_VALIDATION_RUNBOOK.md`](CONTROLLED_MANUAL_VALIDATION_RUNBOOK.md) (with [`DEVELOPER_MODE_DISTRIBUTION.md`](DEVELOPER_MODE_DISTRIBUTION.md) as the installation summary).

Passing `verify:release` is evidence of code and artifact hygiene, not a clinical validation, deployment approval, or provider end-to-end certification.
