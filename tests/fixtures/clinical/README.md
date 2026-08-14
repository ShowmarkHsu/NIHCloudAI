# Synthetic characterization fixtures

These six fixtures are intentionally small, wholly synthetic, and designed to
lock the untouched upstream baseline before any AI integration begins. They do
not contain exported NHI payloads, screenshots, real identifiers, realistic
patient demographics, or copied records from upstream's large JSON samples.

Run the deterministic, non-interactive replay in CI or locally:

```text
npm run test:fixtures
```

The replay validates exact fixture envelopes, monotonic event order, declared
session/patient pairs, source terminal states, late-result rejection, an
explicit synthetic marker, and a conservative direct-identifier scan. The
source bodies preserve only the minimum shapes needed by future upstream
characterization tests. They are not a clinical projection contract and must
not be reused as Provider input.

Later B1 commits will add processor/clipboard observable goldens and browser
visual baselines. This first commit deliberately does not modify
`FloatingIcon`, `legacyContent`, `dataManager`, any processor, iframe, Provider,
or UI code.
