import { describe, expect, it } from 'vitest';
import { err, ManualSelectionExtractor, ok, type ClaimExtractor, type CloudReviewer, type Result } from '../src/index.ts';
import { docs, setup, URL_DOCS, V1_QUOTE } from './fixtures.ts';

const manual = new ManualSelectionExtractor();
const withSelection = (raw: ReturnType<typeof docs>, selection = V1_QUOTE) => ({ ...raw, selection });

/** Fake MODEL strategy: returns canned candidates and an SDK-reported source. */
const fakeNano = (quotes: string[]): ClaimExtractor => ({
  method: 'MODEL',
  extract: async () => ok({ candidates: quotes.map((q) => ({ quote: q, summary: q })), inferenceSource: 'ON_DEVICE', latencyMs: 42 }),
});

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

/** v1 → save (manual) → decision linked → returns ids. */
async function savedDecision(env = setup()) {
  const saved = unwrap(await env.service.saveEvidence(withSelection(docs('1,000')), manual));
  const claim = saved.claims[0]!;
  const decision = unwrap(await env.service.createDecision({ question: 'Ingestion provider?', selection: 'Provider A', claimIds: [claim.id] }));
  return { ...env, claim, decision };
}

describe('save evidence', () => {
  it('stores MODEL claims with the SDK-reported source and blocks unverified ones from linking', async () => {
    const { service } = setup();
    const saved = unwrap(await service.saveEvidence(docs('1,000'), fakeNano([V1_QUOTE, 'Provider A is the fastest provider.'])));
    expect(saved.inferenceSource).toBe('ON_DEVICE');
    expect(saved.claims.map((c) => c.verification)).toEqual(['VERIFIED_EXACT', 'UNVERIFIED']);
    expect(saved.claims[0]!.inferenceSource).toBe('ON_DEVICE');
    const d = unwrap(await service.createDecision({ question: 'q', selection: 's' }));
    const linked = await service.linkClaim(d.id, saved.claims[1]!.id);
    expect(!linked.ok && linked.error.code).toBe('UNVERIFIED_CLAIM');
  });

  it('T19/T23 MANUAL claims carry anchors and no inference source', async () => {
    const { claim } = await savedDecision();
    expect(claim.captureMethod).toBe('MANUAL');
    expect(claim.inferenceSource).toBeUndefined();
    expect(claim.anchorPrefix).toBe('Provider A rate limit is');
  });

  it('reuses the snapshot for identical content and does not duplicate claims', async () => {
    const { service } = setup();
    const a = unwrap(await service.saveEvidence(withSelection(docs('1,000')), manual));
    const b = unwrap(await service.saveEvidence(withSelection(docs('1,000')), manual));
    expect(b.snapshotReused).toBe(true);
    expect(b.snapshot.id).toBe(a.snapshot.id);
    expect(b.claims).toEqual([]);
  });

  it('surfaces extractor failures without writing claims (fail closed, no cloud fallback)', async () => {
    const { service, vault } = setup();
    const unavailable: ClaimExtractor = { method: 'MODEL', extract: async () => err('MODEL_UNAVAILABLE', 'Gemini Nano not available') };
    const r = await service.saveEvidence(docs('1,000'), unavailable);
    expect(!r.ok && r.error.code).toBe('MODEL_UNAVAILABLE');
    expect(await vault.claims.list()).toEqual([]);
  });
});

describe('re-check and decision lifecycle', () => {
  it('T05/T19 v1 → v2 flags the decision with an exact before/after', async () => {
    const { service, clock, decision } = await savedDecision();
    clock.advance();
    const r = unwrap(await service.recheck(docs('300')));
    expect(r.flaggedDecisionIds).toEqual([decision.id]);
    expect(r.items[0]!.event).toMatchObject({
      observedDiff: 'TEXT_CHANGED', previousQuote: V1_QUOTE, currentExcerpt: 'Provider A rate limit is 300 requests/minute.',
    });
    const view = unwrap(await service.getDecisionView(decision.id));
    expect(view.decision.status).toBe('NEEDS_REVIEW');
    expect(view.evidence[0]!.edge.state).toBe('CHANGED');
    expect(view.audit.map((a) => a.action)).toEqual(['CREATED', 'FLAGGED_NEEDS_REVIEW']);
  });

  it('T04 unrelated edits do not flag; a page hash change alone is not a review', async () => {
    const { service, decision } = await savedDecision();
    const r = unwrap(await service.recheck(docs('1,000', { footer: 'Footer moved.' })));
    expect(r.snapshotReused).toBe(false);
    expect(r.flaggedDecisionIds).toEqual([]);
    expect(unwrap(await service.getDecisionView(decision.id)).evidence[0]!.edge.state).toBe('PRESENT');
  });

  it('repeating the same re-check creates no duplicate events or audit entries', async () => {
    const { service, vault, claim, decision } = await savedDecision();
    await service.recheck(docs('300'));
    const again = unwrap(await service.recheck(docs('300')));
    expect(again.snapshotReused).toBe(true);
    expect(again.items[0]!.newEvent).toBe(false);
    expect(await vault.changes.listByClaim(claim.id)).toHaveLength(1);
    expect((await vault.audit.listByDecision(decision.id)).filter((a) => a.action === 'FLAGGED_NEEDS_REVIEW')).toHaveLength(1);
  });

  it('T09/T22 after KEEP, an unrelated v3 edit never re-flags; a new value does', async () => {
    const { service, decision } = await savedDecision();
    await service.recheck(docs('300'));
    expect(unwrap(await service.resolve(decision.id, { type: 'KEEP' })).status).toBe('SUPPORTED');

    const footerOnly = unwrap(await service.recheck(docs('300', { footer: 'Footer v3.' })));
    expect(footerOnly.flaggedDecisionIds).toEqual([]);
    const kept = unwrap(await service.getDecisionView(decision.id));
    expect(kept.decision.status).toBe('SUPPORTED');
    expect(kept.evidence[0]!.edge.state).toBe('CHANGED'); // freshness stays visible after KEEP

    const newValue = unwrap(await service.recheck(docs('500')));
    expect(newValue.flaggedDecisionIds).toEqual([decision.id]);
    expect(unwrap(await service.getDecisionView(decision.id)).pendingEvents[0]!.currentExcerpt)
      .toBe('Provider A rate limit is 500 requests/minute.');
  });

  it('T10 REVISE then a genuinely new change flags again; the old event stays acknowledged', async () => {
    const { service, decision } = await savedDecision();
    await service.recheck(docs('300'));
    const firstEvent = unwrap(await service.getDecisionView(decision.id)).pendingEvents[0]!.id;
    unwrap(await service.resolve(decision.id, { type: 'REVISE', selection: 'Provider A (with batching)' }));
    await service.recheck(docs('200'));
    const v = unwrap(await service.getDecisionView(decision.id));
    expect(v.decision.status).toBe('NEEDS_REVIEW');
    expect(v.decision.acknowledgedChangeEventIds).toEqual([firstEvent]);
    expect(v.audit.find((a) => a.action === 'RESOLVED_REVISED')?.before?.selection).toBe('Provider A');
  });

  it('T11 a retired decision stays retired on re-check', async () => {
    const { service, decision } = await savedDecision();
    unwrap(await service.resolve(decision.id, { type: 'RETIRE', note: 'Project cancelled' }));
    const r = unwrap(await service.recheck(docs('300')));
    expect(r.flaggedDecisionIds).toEqual([]);
    expect(unwrap(await service.getDecisionView(decision.id)).decision.status).toBe('RETIRED');
  });

  it('T08 two decisions on one claim share one event and are both flagged', async () => {
    const env = await savedDecision();
    const second = unwrap(await env.service.createDecision({ question: 'Burst budget?', selection: 'No queue', claimIds: [env.claim.id] }));
    const r = unwrap(await env.service.recheck(docs('300')));
    expect(r.flaggedDecisionIds.sort()).toEqual([env.decision.id, second.id].sort());
    expect(await env.vault.changes.listByClaim(env.claim.id)).toHaveLength(1);
  });

  it('never auto-clears NEEDS_REVIEW when the original quote comes back', async () => {
    const { service, decision } = await savedDecision();
    await service.recheck(docs('300'));
    await service.recheck(docs('1,000'));
    expect(unwrap(await service.getDecisionView(decision.id)).decision.status).toBe('NEEDS_REVIEW');
  });

  it('rejects re-checking a page that was never saved', async () => {
    const { service } = setup();
    const r = await service.recheck({ ...docs('300'), url: 'https://other.example/docs' });
    expect(!r.ok && r.error.code).toBe('NOT_FOUND');
  });
});

describe('cloud review (consent-gated)', () => {
  it('T13 no consent → no request; consent → reviewer receives only the preview payload', async () => {
    const { service, decision } = await savedDecision();
    await service.recheck(docs('300'));
    const payload = unwrap(await service.buildReviewPayload(decision.id));
    expect(JSON.stringify(payload)).not.toContain('Bursts are smoothed'); // no full page text
    expect(payload.evidence[0]).toMatchObject({ observedChange: 'TEXT_CHANGED', previousQuote: V1_QUOTE });

    const sent: string[] = [];
    const reviewer: CloudReviewer = { review: async (p) => (sent.push(p), ok({ text: 'Revise.', inferenceSource: 'IN_CLOUD', latencyMs: 5 })) };
    const denied = await service.cloudReview(reviewer, payload, false);
    expect(!denied.ok && denied.error.code).toBe('CONSENT_REQUIRED');
    expect(sent).toEqual([]);
    const allowed = await service.cloudReview(reviewer, payload, true);
    expect(allowed.ok && allowed.value.inferenceSource).toBe('IN_CLOUD');
    expect(sent).toEqual([JSON.stringify(payload)]);
  });
});

describe('search', () => {
  it('finds saved evidence and decisions offline', async () => {
    const { service } = await savedDecision();
    const hits = await service.search('provider');
    expect(hits.map((h) => h.kind).sort()).toEqual(['claim', 'decision']);
    expect(URL_DOCS).toContain('docs');
  });
});
