# ContextWeave AI

**Decision-aware research memory.** Save verified quotes from web pages, link them to your decisions, and get flagged when the source text behind a decision changes.

Built for **#BuildHybridAI 2026** (Web / Chrome) with **Firebase AI Logic**:

- **On-device (Gemini Nano, `ONLY_ON_DEVICE`)** proposes candidate claims from the page you clicked Save on. Page text does not go to a cloud model on this path.
- **Deterministic code** verifies every quote verbatim, versions snapshots (SHA-256), detects changes and moves decisions to `NEEDS_REVIEW`. No AI decides what changed.
- **Cloud (Gemini, `ONLY_IN_CLOUD`)** is optional. You see the exact JSON first, and nothing is sent until you click *Send*.

Provenance badges come from the SDK's `response.inferenceSource`, never from the requested mode.

```
Save evidence → verify quote → link to decision → re-check page → NEEDS_REVIEW → Keep / Revise / Retire
```

## Repository layout

```
packages/core/          Pure TypeScript domain + application logic (no Chrome, no Firebase)
  src/domain/           Types (PRD v1.5 §05) and Result type
  src/text/             Normalization with raw-offset mapping, sentences, chunking, word diff
  src/capture/          Capture pipeline (chain of steps with typed failures)
  src/evidence/         Quote verification, deterministic anchors, re-check classifier, fingerprints
  src/decisions/        Decision state machine + audit events
  src/extraction/       Prompt, JSON schema, response parsing, Manual strategy
  src/app/              ContextWeaveService use cases, search, cloud payload
  src/ports.ts          Repository / infrastructure / strategy interfaces
  src/testing/          In-memory vault, fixed clock, sequential ids
  test/                 Vitest suites (57 tests)
apps/extension/         Chrome MV3 side panel (adapters + thin UI)
  src/adapters/         IndexedDB vault, page capture, Firebase init + App Check, Gemini strategies
  src/sidepanel/        UI
apps/fixture/public/    Hosted demo page (same URL, v1/v2/v3 toggle) for Firebase Hosting
docs/                   Architecture, judge guide, build log
```

## Quick start (developers)

Requirements: Node 20+, Chrome desktop 139+ with the on-device model available (see the [judge guide](docs/JUDGE_GUIDE.md#requirements)).

```bash
npm install
npm test                 # core unit tests, no browser or network needed
cp apps/extension/.env.example apps/extension/.env   # fill in your Firebase web config
npm run build            # → apps/extension/dist
```

Load `apps/extension/dist` via `chrome://extensions` → Developer mode → **Load unpacked**. Open the side panel from the toolbar icon. In **Diagnostics**, paste an App Check debug token (Firebase console → App Check → Manage debug tokens) and click *Save token & reload*.

Deploy the demo page: `firebase deploy --only hosting` (copy `.firebaserc.example` to `.firebaserc` first).

`npm run check` runs typecheck, tests and the build together.

## Demo flow (3 minutes)

1. Open the hosted `/docs/` page (v1: *1,000 requests/minute*).
2. Click **Save evidence**. Claims appear with **Verified exact** and **ON_DEVICE** badges. If Nano isn't available, highlight the sentence and click **Save selection**.
3. Create the decision *"Which provider for ingestion?" → "Provider A"* and link the rate-limit claim.
4. On the page, click **v2 · 300**, then **Re-check this page**. The decision turns **NEEDS_REVIEW** with a before/after diff.
5. Optionally click **Cloud review…**, inspect the payload, and send it.
6. **Revise** the decision. The History panel shows the before and after versions.
7. Try **v2 + unrelated edit**: no new flag. Try **v3 · 500**: flagged again.

## Status (honest)

| Area | State |
|---|---|
| Core rules, state machine, re-check, anchors, idempotency | Implemented; 57 unit tests pass |
| Extension build (MV3, bundled, no remote code) | Builds |
| Real Gemini Nano response in the extension (`ON_DEVICE`) | **Not yet verified on hardware**; this is the day-1 gate |
| App Check debug token from the extension origin | **Not yet verified** |
| Hosted demo page | Ready to deploy; not deployed |
| Revisit reminder (FR-18, P1) | Deferred: needs the `tabs` permission, which conflicts with the privacy stance |

## License

Apache-2.0. See [LICENSE](LICENSE).
