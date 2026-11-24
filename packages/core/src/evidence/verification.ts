import type { Section, Snapshot, VerificationStatus } from '../domain/types.ts';
import { locateQuote, type TextMatch } from '../text/normalize.ts';

/**
 * Deterministic quote verification (PRD 06-A). Independent of model confidence:
 * a quote is evidence only if it is literally (or after presentation-noise
 * normalization) present in the captured snapshot.
 */
export interface VerificationOutcome {
  status: VerificationStatus;
  /** First raw match, when verified. */
  match?: TextMatch;
}

export function verifyQuote(snapshotText: string, quote: string): VerificationOutcome {
  if (!quote.trim()) return { status: 'UNVERIFIED' };
  const [first] = locateQuote(snapshotText, quote);
  if (!first) return { status: 'UNVERIFIED' };
  return {
    status: first.basis === 'EXACT' ? 'VERIFIED_EXACT' : 'VERIFIED_NORMALIZED',
    match: first,
  };
}

/** Heading of the section containing raw index `pos`, if any. */
export function sectionAt(sections: Section[], pos: number): string | undefined {
  let heading: string | undefined;
  for (const s of sections) {
    if (s.start <= pos) heading = s.heading;
    else break;
  }
  return heading;
}

export const snapshotSectionAt = (snap: Snapshot, pos: number) => sectionAt(snap.sections, pos);
