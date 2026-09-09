# Visual and semantic characterization

This harness is synthetic-only. It imports and mounts the production
`FloatingIcon` and `PopupSettings` components directly from `src`; it does not
copy or fork their rendering implementation. The harness adapts the six
fixtures in `tests/fixtures/clinical`, fixes the clock declared by each fixture,
and mocks only Chrome extension APIs at the test boundary.

The adapter replays each fixture in sequence, clears source state on patient
switch, and projects only the accepted active-session snapshot into the legacy
window globals. Race and malformed cases therefore characterize the synthetic
snapshot boundary; they do not claim that `FloatingIcon` itself owns a session
coordinator or exposes upstream HTTP status in production.

Install the pinned browser once, then run the non-interactive suite:

```sh
npx playwright install chromium
npm run test:visual
```

The npm command first runs a bounded single-case lifecycle regression. Its
runner then owns the Vite child process directly, waits for the synthetic
harness to become ready, forwards Playwright's exit status, and shuts down only
the server it started. This avoids relying on Playwright's Windows process-tree
teardown and leaves no managed server running after the command exits.

The legacy browser Mocha suite is also available without an interactive
browser or a lingering server process through `npm run test:browser`.

Approved baselines are refreshed deliberately with
`npm run test:visual:update`. The suite runs `1440x900` and `1024x768` projects,
captures regions instead of whole pages, and pairs screenshots with accessible
name, tab order, conditional Advanced, visible-control, overlap, clipping, and
scroll assertions. The 51 approved region goldens cover default/full/CKM
overview, western list/table, Chinese medication, five lab layouts plus table,
imaging report/pending rows, leftovers, both custom editors, seven settings
accordions, and narrow tab scrolling. Browser semantics additionally replay
patient-switch, sparse/malformed, empty/denied, and fixed-clock boundary cases.
The sealed AI integration cases also verify that the production AI tab is
safe-empty before a sealed snapshot exists, then displays only sealed lab
coverage and human-readable opaque source aliases after the boundary event,
without exposing the raw source alias.

CI must install the pinned Chromium build before invoking
`npm run test:visual`. Snapshot paths intentionally omit the host OS suffix;
the runner still needs stable fonts and the pinned Chromium build to avoid
glyph-metric drift. No extension, live NHI session, PHI, upstream JSON, or
network service is required while the tests run.
