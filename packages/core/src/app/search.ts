import type { Claim, Decision } from '../domain/types.ts';

/**
 * Offline keyword search (FR-05). A linear AND-of-terms scan is fine for a
 * personal vault of hundreds of items; swap in MiniSearch behind this same
 * function if it ever matters.
 */
export type SearchHit =
  | { kind: 'claim'; item: Claim; score: number }
  | { kind: 'decision'; item: Decision; score: number };

const terms = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

function score(haystack: string, ts: string[]): number {
  const h = haystack.toLowerCase();
  let s = 0;
  for (const t of ts) {
    if (!h.includes(t)) return 0;
    s += h.split(t).length - 1;
  }
  return s;
}

export function searchVault(query: string, claims: Claim[], decisions: Decision[]): SearchHit[] {
  const ts = terms(query);
  if (ts.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const c of claims) {
    const s = score(`${c.exactQuote} ${c.summary} ${c.sectionHeading ?? ''}`, ts);
    if (s > 0) hits.push({ kind: 'claim', item: c, score: s });
  }
  for (const d of decisions) {
    const s = score(`${d.question} ${d.selection} ${d.rationale ?? ''}`, ts);
    if (s > 0) hits.push({ kind: 'decision', item: d, score: s });
  }
  return hits.sort((a, b) => b.score - a.score);
}
