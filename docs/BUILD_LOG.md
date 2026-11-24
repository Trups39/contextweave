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
- 57 unit tests (59 after the polish batch).
- `apps/extension`: MV3 side panel, IndexedDB vault, page capture, Firebase AI Logic strategies (`ONLY_ON_DEVICE` extractor, `ONLY_IN_CLOUD` reviewer), App Check debug-token bootstrap, diagnostics.
- `apps/fixture`: same-URL demo page with v1, v2, v2b and v3 states.

- Verified on a real machine (Chrome 158, Windows): Gemini Nano extraction through Firebase AI Logic returns `inferenceSource = ON_DEVICE` inside the packaged extension; all 5 extracted quotes verified exact; v1 → v2 re-check flags the linked decision NEEDS_REVIEW with the 1,000 → 300 diff.
- Fixes found during that test: Vite now loads `.env` from `apps/extension/`; cloud model default changed to `gemini-3.8-flash` (`gemini-2.5-flash` is closed to new projects).
- Polish: cloud review retries transient 429/500/503 errors; faster on-device extraction (≤5 short claims, ≤2 chunks); per-site permissions instead of "all websites"; Revise can adopt the current source sentence as new evidence; collapsible "+ New decision" form; singular/plural wording.

## Pre-existing code or assets

- An earlier starter (`src/core.js` with 10 `node:test` cases) existed before this repository. **TODO: confirm its creation date.** It was not copied here; this codebase was written fresh on Nov 24.
- Third-party libraries: Firebase JS SDK, idb, Vite, Vitest, TypeScript.

## Not yet verified (update as you go)

- [x] Real `ON_DEVICE` response inside the packaged extension
- [x] App Check debug token accepted from the extension origin (cloud call reached the model)
- [x] Demo page deployed to Firebase Hosting
- [ ] Successful IN_CLOUD review (blocked only by temporary model overload so far)
- [ ] Clean-machine install from the judge guide
