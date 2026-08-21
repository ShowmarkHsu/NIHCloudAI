# B6 Engineering Gate Evidence

> **狀態說明（2026-08-21）**：本文件只記錄 machine-verifiable engineering gate。
> 目前產品中的 AI 頁籤尚未接上 UI flow，Provider request 也尚未承載 sealed
> snapshot／clinical facts，因此不得把本文件解讀為 AI 功能可用、release ready、
> Provider 端對端通過或臨床驗收完成。完整缺口與復原順序見
> [`PROJECT_RECOVERY_PLAN.md`](PROJECT_RECOVERY_PLAN.md)。

This branch's B6 deliverable is a reproducible engineering gate. It proves only the build-time boundaries that can be checked without accessing a real patient, a Provider account, or a clinical reviewer.

Run the complete gate from the repository root:

```powershell
npm run verify
```

The command verifies the frozen upstream baseline, AI contract suite, TypeScript, lint scope, legacy characterization suite, production build, generated `dist` directory, and the synthetic browser suite. `npm run verify:release` remains the non-browser subset used by CI or constrained environments.

The generated-artifact check fails when any of the following occurs:

- `manifest.json` has a permission other than `storage` and `clipboardWrite`.
- `manifest.json` has a host permission other than the existing fixed NHI Cloud or drug-image host.
- `manifest.json` has an optional host permission other than the fixed Ollama loopback or OpenRouter host.
- A source map or source-map reference is shipped.
- A shipped text artifact contains an API-key or bearer-token shaped value.

Provider execution is background-only. The code fixes Ollama to the loopback endpoint/model and fixes the OpenRouter request route/model; OpenRouter has only an optional host permission and cannot send until the exact current revision has an in-memory BYOK value, explicit outbound-data consent, and the optional host grant. The release check rejects source maps and secret-shaped values in `dist`; it is not evidence of a real Provider connection, account, model availability, or route acceptance.

R1 additionally exercises one real local product seam: a terminal upstream lab result is normalized and quarantined inside a closed module, sealed with coverage and a local reference vault, accepted by the background store, and rendered in the existing AI tab as coverage plus opaque source aliases. It does not invoke an LLM. The later synthetic summary UI-flow tests verify that a sealed data state can enable user-initiated generation, fixed five-section validation, source review, and copy gating. They do not mean this content-script tab has selected or implemented the required extension-origin Provider UI architecture. Error, cancellation, session end, revision change, and patient change clear review/copy eligibility. No visual snapshot update is part of this gate.

The synthetic runtime lifecycle tests cover the closed content-to-background capability path: content emits only lifecycle messages after its existing terminal data-fetch event, ends the current scope on patient-switch and page-exit events, and the background clears the matching scope when Chrome reports tab removal. These tests contain no patient payload, credentials, Provider request, screenshot, or session value from a browser.

## Manual gates required before a clinical or production release

These checks cannot be truthfully performed by repository automation and remain the release owner's responsibility:

- A qualified clinician and pharmacist review and sign off on the synthetic clinical acceptance cases.
- An authorized operator verifies the intended Chrome build against approved test patients only; no real data, screenshot, request body, key, or session value may enter this repository.
- Before any remote Provider connection, the owner records the exact endpoint/model/version, asks for outbound-data consent for that session, confirms the optional host grant, validates session-only secret handling, and re-runs the gate with the least-privilege permission policy.
- The release owner completes the developer-mode install, update, and removal checklist in `DEVELOPER_MODE_DISTRIBUTION.md`.

Passing `verify:release` is evidence of code and artifact hygiene, not a clinical validation, deployment approval, or provider end-to-end certification.
