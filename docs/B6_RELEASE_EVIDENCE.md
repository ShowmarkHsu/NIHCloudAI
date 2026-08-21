# B6 Release Evidence — Machine-verifiable Gate

This branch's B6 deliverable is a reproducible release-readiness gate. It proves the build-time boundaries that can be checked without accessing a real patient, a Provider account, or a clinical reviewer.

Run the complete gate from the repository root:

```powershell
npm run verify:release
```

The command verifies the frozen upstream baseline, AI contract suite, TypeScript, lint scope, legacy characterization suite, production build, and the generated `dist` directory.

The generated-artifact check fails when any of the following occurs:

- `manifest.json` has a permission other than `storage` and `clipboardWrite`.
- `manifest.json` has a host permission other than the existing fixed NHI Cloud or drug-image host.
- A source map or source-map reference is shipped.
- A shipped text artifact contains an API-key or bearer-token shaped value.

The current branch has no Provider runtime, remote host permission, iframe, or real patient-data path. The gate must be expanded before one of those capabilities is introduced; it intentionally does not pre-authorize them.

## Manual gates required before a clinical or production release

These checks cannot be truthfully performed by repository automation and remain the release owner's responsibility:

- A qualified clinician and pharmacist review and sign off on the synthetic clinical acceptance cases.
- An authorized operator verifies the intended Chrome build against approved test patients only; no real data, screenshot, request body, key, or session value may enter this repository.
- If a remote Provider is introduced, the owner records the exact endpoint/model/version, confirms explicit outbound-data consent, validates session-only secret handling, and re-runs the gate with the new least-privilege permission policy.
- The release owner completes the developer-mode install, update, and removal checklist in `DEVELOPER_MODE_DISTRIBUTION.md`.

Passing `verify:release` is evidence of code and artifact hygiene, not a clinical validation, deployment approval, or provider end-to-end certification.
