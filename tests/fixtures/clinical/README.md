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
explicit synthetic marker, a conservative direct-identifier scan, and the
detailed Ticket 02 coverage matrix for every fixture family. The source bodies
exercise characterization cases only. They are not a clinical projection
contract and must not be reused as Provider input.

Run the non-AI settings, tabs, processor, and byte-exact clipboard goldens with:

```text
npm run test:characterization
```

The next B1 commit will add browser visual baselines. This batch deliberately
does not modify `FloatingIcon`, `legacyContent`, `dataManager`, any processor,
iframe, Provider, or UI code.
