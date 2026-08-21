# B6 Release Evidence — Machine-verifiable Gate

This branch's B6 deliverable is a reproducible release-readiness gate. It proves the build-time boundaries that can be checked without accessing a real patient, a Provider account, or a clinical reviewer.

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

Provider execution is background-only. Ollama is fixed to the loopback endpoint and model; OpenRouter is fixed to its documented endpoint and model, has only an optional host permission, and cannot send until the current session has both an in-memory BYOK value and explicit outbound-data consent. The release check rejects source maps and secret-shaped values in `dist`; it is not evidence of a real Provider connection.

The minimal AI Summary tab is release-gated by synthetic UI-flow tests: a sealed data state enables a user-initiated generation, output must validate as the fixed five-section schema, each section exposes only source references for review, and copy remains disabled until explicit review. Error, cancellation, session end, revision change, and patient change clear review/copy eligibility. No visual snapshot update is part of this gate.

## Manual gates required before a clinical or production release

These checks cannot be truthfully performed by repository automation and remain the release owner's responsibility:

- A qualified clinician and pharmacist review and sign off on the synthetic clinical acceptance cases.
- An authorized operator verifies the intended Chrome build against approved test patients only; no real data, screenshot, request body, key, or session value may enter this repository.
- Before any remote Provider connection, the owner records the exact endpoint/model/version, asks for outbound-data consent for that session, confirms the optional host grant, validates session-only secret handling, and re-runs the gate with the least-privilege permission policy.
- The release owner completes the developer-mode install, update, and removal checklist in `DEVELOPER_MODE_DISTRIBUTION.md`.

Passing `verify:release` is evidence of code and artifact hygiene, not a clinical validation, deployment approval, or provider end-to-end certification.
