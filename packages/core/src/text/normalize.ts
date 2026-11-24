/**
 * Symmetric text normalization for VERIFIED_NORMALIZED matching (PRD 06-A).
 *
 * Only presentation noise is normalized: smart quotes, Unicode spaces and
 * whitespace runs. Case, punctuation and digits are NOT normalized, because
 * "1,000" vs "1000" or "Provider A" vs "provider a" can be meaningful.
 *
 * `normalizeWithMap` also returns, for every normalized character, the index of
 * the raw character it came from, so a normalized match can be traced back to
 * an exact raw substring (needed for section lookup and excerpts).
 */

const QUOTE_MAP: Record<string, string> = {
  '“': '"', '”': '"', '„': '"', '″': '"',
  '‘': "'", '’': "'", '‚': "'", '′': "'",
};

// NBSP, narrow NBSP, figure space, thin spaces, zero-width space, BOM.
const SPACE_RE = /[\s  -​  　﻿]/;

export interface NormalizedText {
  text: string;
  /** map[i] = index in the raw string of normalized char i. */
  map: number[];
}

export function normalizeWithMap(raw: string): NormalizedText {
  let text = '';
  const map: number[] = [];
  let pendingSpace = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (SPACE_RE.test(ch)) {
      if (pendingSpace < 0) pendingSpace = i;
      continue;
    }
    if (pendingSpace >= 0) {
      if (text.length > 0) {
        text += ' ';
        map.push(pendingSpace);
      }
      pendingSpace = -1;
    }
    text += QUOTE_MAP[ch] ?? ch;
    map.push(i);
  }
  return { text, map };
}

export const normalize = (raw: string): string => normalizeWithMap(raw).text;

/** All start indices of `needle` in `haystack` (non-overlapping). */
export function findAll(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return out;
    out.push(i);
    from = i + needle.length;
  }
}

export interface TextMatch {
  /** Raw start/end (end exclusive) in the original text. */
  start: number;
  end: number;
  basis: 'EXACT' | 'NORMALIZED';
}

/**
 * Locate a quote: exact occurrences first; only if none, normalized ones.
 * Every returned range is a real raw substring of `raw`.
 */
export function locateQuote(raw: string, quote: string): TextMatch[] {
  const exact = findAll(raw, quote);
  if (exact.length > 0) {
    return exact.map((s) => ({ start: s, end: s + quote.length, basis: 'EXACT' as const }));
  }
  const nq = normalize(quote);
  if (!nq) return [];
  const { text, map } = normalizeWithMap(raw);
  return findAll(text, nq).map((s) => ({
    start: map[s]!,
    end: map[s + nq.length - 1]! + 1,
    basis: 'NORMALIZED' as const,
  }));
}
