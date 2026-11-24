import type { Claim, EvidenceStatus, MatchBasis, ObservedDiff, Snapshot } from '../domain/types.ts';
import { locateQuote, normalize } from '../text/normalize.ts';
import { splitSentences, type SentenceSpan } from '../text/sentences.ts';
import { sectionAt } from './verification.ts';

/**
 * Re-check classification (PRD v1.5, 06-B). Pure and deterministic.
 *
 *  1. Old quote present in its own section (or page has no such section) → UNCHANGED
 *     Old quote present ONLY in other sections (e.g. a changelog)        → AMBIGUOUS
 *  2. Old quote absent: sentences containing the stored anchor
 *       exactly one → TEXT_CHANGED (currentExcerpt = that sentence)
 *       none        → MISSING
 *       several     → narrow by section, then by anchorSuffix; still several → AMBIGUOUS
 *
 * Never fabricates text: every excerpt/candidate is an exact substring of the
 * new snapshot. No similarity thresholds in the MVP (deferred, see PRD 06-B).
 */
export interface RecheckOutcome {
  observedDiff: ObservedDiff;
  matchBasis: MatchBasis;
  currentExcerpt?: string;
  candidates?: string[];
  reason: string;
}

export function classifyRecheck(claim: Claim, next: Snapshot): RecheckOutcome {
  const text = next.cleanText;
  const matches = locateQuote(text, claim.exactQuote);

  if (matches.length > 0) {
    const basis = matches[0]!.basis;
    const heading = claim.sectionHeading;
    const headingStillExists = heading !== undefined && next.sections.some((s) => s.heading === heading);
    if (!headingStillExists || matches.some((m) => sectionAt(next.sections, m.start) === heading)) {
      return { observedDiff: 'UNCHANGED', matchBasis: basis, reason: 'Original quote still present.' };
    }
    const elsewhere = matches.map((m) => sectionAt(next.sections, m.start) ?? '(top of page)');
    return {
      observedDiff: 'AMBIGUOUS',
      matchBasis: basis,
      candidates: matches.map((m) => text.slice(m.start, m.end)),
      reason: `Original quote now appears only under "${elsewhere.join('", "')}", not under "${heading}".`,
    };
  }

  const anchor = claim.anchorPrefix ?? claim.anchorSuffix;
  if (!anchor) {
    return { observedDiff: 'MISSING', matchBasis: 'NONE', reason: 'Original quote no longer found; claim has no anchor.' };
  }

  const nAnchor = normalize(anchor);
  let candidates = splitSentences(text).filter((s) => normalize(s.text).includes(nAnchor));
  candidates = narrow(candidates, (s) => sectionAt(next.sections, s.start) === claim.sectionHeading);
  if (claim.anchorPrefix && claim.anchorSuffix) {
    const nSuffix = normalize(claim.anchorSuffix);
    candidates = narrow(candidates, (s) => normalize(s.text).includes(nSuffix));
  }

  if (candidates.length === 0) {
    return { observedDiff: 'MISSING', matchBasis: 'NONE', reason: 'Original quote no longer found.' };
  }
  if (candidates.length === 1) {
    return {
      observedDiff: 'TEXT_CHANGED',
      matchBasis: 'ANCHOR',
      currentExcerpt: candidates[0]!.text,
      reason: `Original quote no longer found; one sentence matches anchor "${anchor}".`,
    };
  }
  return {
    observedDiff: 'AMBIGUOUS',
    matchBasis: 'ANCHOR',
    candidates: candidates.map((c) => c.text),
    reason: `${candidates.length} sentences match anchor "${anchor}"; check manually.`,
  };
}

/** Keep the filtered subset only if it is non-empty; otherwise keep all. */
function narrow(spans: SentenceSpan[], pred: (s: SentenceSpan) => boolean): SentenceSpan[] {
  if (spans.length <= 1) return spans;
  const kept = spans.filter(pred);
  return kept.length > 0 ? kept : spans;
}

export function edgeStateFor(diff: ObservedDiff): EvidenceStatus {
  switch (diff) {
    case 'UNCHANGED': return 'PRESENT';
    case 'TEXT_CHANGED': return 'CHANGED';
    case 'MISSING': return 'MISSING';
    case 'AMBIGUOUS': return 'AMBIGUOUS';
  }
}

/**
 * Relevant-change fingerprint (PRD v1.5 idempotency). Snapshot IDs are
 * deliberately excluded: an unrelated footer edit yields a new snapshot but the
 * same fingerprint, so it never re-flags a reviewed decision.
 */
export function fingerprintOf(claimId: string, outcome: Pick<RecheckOutcome, 'observedDiff' | 'currentExcerpt' | 'candidates'>): string {
  const body =
    outcome.currentExcerpt !== undefined
      ? normalize(outcome.currentExcerpt)
      : [...(outcome.candidates ?? [])].map(normalize).sort().join('␞');
  return `${claimId}|${outcome.observedDiff}|${body}`;
}
