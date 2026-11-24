# Built during the submission period

Submission period: Nov 11 – Nov 30, 2026. Update this file truthfully before submitting.

## Nov 24, 2026

- Monorepo scaffold (npm workspaces, TypeScript, Vitest, Vite).
- `packages/core`:
  - domain types from PRD v1.5, plus normalization with raw-offset mapping
  - quote verification and deterministic anchors
  - re-check classifier with section awareness and relevant-change fingerprints
  - decision state machine with before/after audit snapshots
  - capture pipeline, extraction prompt, schema and parser, Manual strategy
  - application service, offline search, and consent-gated cloud payload
- 57 unit tests.
- `apps/extension`: MV3 side panel, IndexedDB vault, page capture, Firebase AI Logic strategies (`ONLY_ON_DEVICE` extractor, `ONLY_IN_CLOUD` reviewer), App Check debug-token bootstrap, diagnostics.
- `apps/fixture`: same-URL demo page with v1, v2, v2b and v3 states.

## Pre-existing code or assets

- An earlier starter (`src/core.js` with 10 `node:test` cases) existed before this repository. **TODO: confirm its creation date.** It was not copied here; this codebase was written fresh on Nov 24.
- Third-party libraries: Firebase JS SDK, idb, Vite, Vitest, TypeScript.

## Not yet verified (update as you go)

- [ ] Real `ON_DEVICE` response inside the packaged extension
- [ ] App Check debug token accepted from the extension origin
- [ ] Demo page deployed to Firebase Hosting
- [ ] Clean-machine install from the judge guide
