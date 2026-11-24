import { describe, expect, it } from 'vitest';
import { classifyRecheck, deriveAnchors, fingerprintOf, verifyQuote, type Claim } from '../src/index.ts';
import { docs, page, snapshotOf, V1_QUOTE } from './fixtures.ts';

const v1 = docs('1,000');

function claimFrom(raw: { text: string; sections: { heading: string; start: number }[] }, quote: string): Claim {
  const v = verifyQuote(raw.text, quote);
  const anchors = v.match ? deriveAnchors(quote, raw.text, v.match.start, raw.sections) : {};
  return {
    id: 'c1', snapshotId: 's1', pageId: 'p1', exactQuote: quote, summary: '', ...anchors,
    verification: v.status, captureMethod: 'MANUAL', createdAt: 0,
  };
}

describe('verifyQuote (T01–T03)', () => {
  it('T01 exact quote → VERIFIED_EXACT', () => {
    expect(verifyQuote(v1.text, V1_QUOTE).status).toBe('VERIFIED_EXACT');
  });
  it('T02 whitespace / NBSP / curly-quote variants → VERIFIED_NORMALIZED', () => {
    const raw = 'The “burst” window is   10 seconds.';
    expect(verifyQuote(raw, 'The "burst" window is 10 seconds.').status).toBe('VERIFIED_NORMALIZED');
  });
  it('T03 paraphrased or fabricated quote → UNVERIFIED', () => {
    expect(verifyQuote(v1.text, 'Provider A allows 1000 requests per minute.').status).toBe('UNVERIFIED');
    expect(verifyQuote(v1.text, '   ').status).toBe('UNVERIFIED');
  });
});

describe('deriveAnchors (T23, deterministic for MANUAL and MODEL)', () => {
  it('derives prefix, suffix, context and section without a model', () => {
    const c = claimFrom(v1, V1_QUOTE);
    expect(c.anchorPrefix).toBe('Provider A rate limit is');
    expect(c.anchorSuffix).toBe('requests/minute');
    expect(c.sectionHeading).toBe('Rate limits');
    expect(c.contextBefore).toBeDefined();
    expect(v1.text).toContain(c.contextBefore!);
  });
  it('falls back to the first six words when the quote has no number', () => {
    const raw = page([{ heading: 'Auth', lines: ['Tokens must be rotated by the account owner every quarter.'] }]);
    const c = claimFrom(raw, 'Tokens must be rotated by the account owner every quarter.');
    expect(c.anchorPrefix).toBe('Tokens must be rotated by the');
  });
  it('omits a too-short prefix when the quote starts with a number but keeps the suffix', () => {
    const raw = page([{ lines: ['300 requests per minute is the default ceiling.'] }]);
    const c = claimFrom(raw, '300 requests per minute is the default ceiling.');
    expect(c.anchorPrefix).toBeUndefined();
    expect(c.anchorSuffix).toBe('requests per minute is the default ceiling');
  });
});

describe('classifyRecheck', () => {
  const claim = claimFrom(v1, V1_QUOTE);

  it('T04 identical quote with unrelated edits → UNCHANGED', () => {
    const r = classifyRecheck(claim, snapshotOf(docs('1,000', { footer: 'New footer text.' })));
    expect(r.observedDiff).toBe('UNCHANGED');
  });
  it('T05 1,000 → 300 → TEXT_CHANGED with an exact excerpt from the new snapshot', () => {
    const next = docs('300');
    const r = classifyRecheck(claim, snapshotOf(next));
    expect(r.observedDiff).toBe('TEXT_CHANGED');
    expect(r.matchBasis).toBe('ANCHOR');
    expect(r.currentExcerpt).toBe('Provider A rate limit is 300 requests/minute.');
    expect(next.text).toContain(r.currentExcerpt!);
  });
  it('T06 quote removed with no anchored replacement → MISSING, nothing invented', () => {
    const next = page([{ heading: 'Rate limits', lines: ['Limits are now negotiated per contract.'] }]);
    const r = classifyRecheck(claim, snapshotOf(next));
    expect(r.observedDiff).toBe('MISSING');
    expect(r.currentExcerpt).toBeUndefined();
  });
  it('T07 two equally plausible replacements → AMBIGUOUS with both candidates', () => {
    const next = page([{
      heading: 'Rate limits',
      lines: ['Provider A rate limit is 300 requests/minute for Free.', 'Provider A rate limit is 600 requests/minute for Pro.'],
    }]);
    const r = classifyRecheck(claim, snapshotOf(next));
    expect(r.observedDiff).toBe('AMBIGUOUS');
    expect(r.candidates).toHaveLength(2);
  });
  it('narrows several anchor matches to the claim\'s own section', () => {
    const next = docs('300', { changelog: ['Provider A rate limit is now 300 requests/minute (was 1,000).'] });
    const r = classifyRecheck(claim, snapshotOf(next));
    expect(r.observedDiff).toBe('TEXT_CHANGED');
    expect(r.currentExcerpt).toBe('Provider A rate limit is 300 requests/minute.');
  });
  it('T24 old quote survives only in a changelog section → AMBIGUOUS, not UNCHANGED', () => {
    const next = page([
      { heading: 'Rate limits', lines: ['Limits are now negotiated per contract.'] },
      { heading: 'Changelog', lines: [`Previously: ${V1_QUOTE}`] },
    ]);
    const r = classifyRecheck(claim, snapshotOf(next));
    expect(r.observedDiff).toBe('AMBIGUOUS');
    expect(r.reason).toContain('Changelog');
  });
  it('falls back to a global match when the claim\'s heading was renamed', () => {
    const next = page([{ heading: 'Quotas', lines: [V1_QUOTE] }]);
    expect(classifyRecheck(claim, snapshotOf(next)).observedDiff).toBe('UNCHANGED');
  });
  it('reports MISSING for a claim without any anchor', () => {
    const bare: Claim = { ...claim, anchorPrefix: undefined, anchorSuffix: undefined };
    delete bare.anchorPrefix; delete bare.anchorSuffix;
    expect(classifyRecheck(bare, snapshotOf(docs('300'))).observedDiff).toBe('MISSING');
  });
});

describe('fingerprintOf', () => {
  it('ignores snapshot identity and whitespace, but not the changed value', () => {
    const a = fingerprintOf('c1', { observedDiff: 'TEXT_CHANGED', currentExcerpt: 'limit is 300' });
    const b = fingerprintOf('c1', { observedDiff: 'TEXT_CHANGED', currentExcerpt: 'limit  is 300' });
    const c = fingerprintOf('c1', { observedDiff: 'TEXT_CHANGED', currentExcerpt: 'limit is 500' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('is order-independent for ambiguous candidates', () => {
    expect(fingerprintOf('c', { observedDiff: 'AMBIGUOUS', candidates: ['x', 'y'] }))
      .toBe(fingerprintOf('c', { observedDiff: 'AMBIGUOUS', candidates: ['y', 'x'] }));
  });
});
