# Visual and semantic characterization

This harness is synthetic-only. It mounts the unchanged upstream
`FloatingIcon` and `PopupSettings` components, adapts the six fixtures in
`tests/fixtures/clinical`, fixes the clock declared by each fixture, and mocks
only Chrome extension APIs at the test boundary.

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

CI must install the pinned Chromium build before invoking
`npm run test:visual`. Snapshot paths intentionally omit the host OS suffix;
the runner still needs stable fonts and the pinned Chromium build to avoid
glyph-metric drift. No extension, live NHI session, PHI, upstream JSON, or
network service is required while the tests run.
