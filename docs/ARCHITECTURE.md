# Architecture

ContextWeave follows a hexagonal (ports and adapters) layout. All rules that decide what is true about evidence and decisions live in `packages/core` and run in Node with no browser, network or SDK. The extension provides the adapters.

```
            ┌──────────────── apps/extension ────────────────┐
 click ───▶ │ sidepanel/main.ts  (thin UI, composition root)  │
            │   │                                             │
            │   ├─ adapters/pageCapture.ts  (chrome.scripting) │
            │   ├─ adapters/idbVault.ts     (IndexedDB)        │
            │   ├─ adapters/geminiStrategies.ts                │
            │   │     GeminiNanoExtractor  ONLY_ON_DEVICE      │
            │   │     GeminiCloudReviewer  ONLY_IN_CLOUD       │
            │   └─ adapters/firebase.ts     (App Check debug)  │
            └───────────────────┬─────────────────────────────┘
                                │ ports.ts
            ┌───────────────────▼──────── packages/core ──────┐
            │ app/service.ts  ContextWeaveService (use cases) │
            │ capture/pipeline.ts   evidence/*                │
            │ decisions/stateMachine.ts   extraction/*        │
            └─────────────────────────────────────────────────┘
```

## Patterns and where they live

| Pattern | Where | Why |
|---|---|---|
| Hexagonal separation | `ports.ts`, `apps/extension/src/adapters/*` | Rules are testable without Chrome or Firebase; adapters only move data. |
| Strategy | `ClaimExtractor` (`GeminiNanoExtractor`, `ManualSelectionExtractor`), `CloudReviewer` | Manual capture is a first-class strategy, so judges without Nano hardware can still run the whole loop. |
| Pipeline / chain | `capture/pipeline.ts` | `requireUserInitiated → validateUrl → canonicalize → sanitize → requireContent`; each step returns a typed `Result`. |
| State machine + audit log | `decisions/stateMachine.ts`, `AuditLog` port | Explicit transitions; the audit log is append-only (IndexedDB `add`), and revisions store `before`/`after` snapshots. |
| Repository | `Vault` port, `idbVault.ts`, `testing/memoryVault.ts` | Storage and indexes are swappable; tests use the in-memory vault. |

## Key decisions and trade-offs

- **Failures are values.** Expected failures (model unavailable, unverified quote, illegal transition, no consent) return `Result` with a code the UI shows. Exceptions are reserved for programmer errors.
- **On-device fails closed.** `GeminiNanoExtractor` uses `ONLY_ON_DEVICE` and also rejects any response whose `inferenceSource` isn't `on_device`. There is no automatic cloud fallback.
- **Anchors are deterministic.** The `anchorPrefix` (quote text before the first number), `anchorSuffix`, `contextBefore` and `sectionHeading` are computed by code for both MODEL and MANUAL claims.
- **Re-check classification** (`evidence/recheck.ts`):
  1. Quote present in its own section → `UNCHANGED`. Present only in another section → `AMBIGUOUS`.
  2. If absent, find the sentences that contain the anchor and narrow them by section, then by suffix. One match is `TEXT_CHANGED`, none is `MISSING`, and several are `AMBIGUOUS`.

  Every excerpt is an exact substring of the new snapshot. Similarity thresholds are deliberately out of scope.
- **Idempotency.** A change event is identified by `claimId | observedDiff | normalized excerpt`, without the snapshot ID. On KEEP or REVISE, each support edge stores the `reviewedFingerprint` the user saw. Unrelated page edits never re-flag a reviewed decision, while a new value does.
- **Freshness ≠ decision status.** After KEEP, the decision is `SUPPORTED`, but its edge still reads `CHANGED`, and the UI shows a "kept after review" warning.
- **No cross-store transactions.** Writes are idempotent by id, so a retried use case converges. That's acceptable for a single-user extension.
- **Permissions, narrowest first.** The build adds only the hosted demo origin (`VITE_DEMO_URL`) to `host_permissions`. Other sites work through `activeTab` after a toolbar click. After a capture succeeds, the extension asks once to remember that one site, so Re-check survives a page reload. It never asks for "all websites", and pages are read only on an explicit click.
- **App Check.** `chrome-extension://` pages can't pass reCAPTCHA, and the reCAPTCHA provider would inject a remote script that MV3 CSP blocks. So the extension supports only debug-token mode with an inert `CustomProvider`. The token is pasted at runtime and stored in `chrome.storage.local`; it is never bundled.
