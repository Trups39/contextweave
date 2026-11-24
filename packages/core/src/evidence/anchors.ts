import type { Section } from '../domain/types.ts';
import { sectionAt } from './verification.ts';

/**
 * Deterministic anchors (PRD v1.5, 06-A step 5), derived identically for MODEL
 * and MANUAL capture so the manual fallback can still detect TEXT_CHANGED.
 *
 *   anchorPrefix  = quote text before its first variable token (number)
 *   anchorSuffix  = quote text after its last variable token
 *   contextBefore = up to 40 raw chars immediately before the quote
 *   sectionHeading= nearest preceding heading
 *
 * Trade-off: "variable token" means a number (with , . % / units attached).
 * That covers limits, prices and versions — the MVP's target claims — without
 * any model. Quotes without numbers fall back to their first six words.
 */
export interface Anchors {
  anchorPrefix?: string;
  anchorSuffix?: string;
  contextBefore?: string;
  sectionHeading?: string;
}

const VARIABLE_TOKEN = /\d[\d,.]*/g;
const MIN_ANCHOR_CHARS = 8;
const CONTEXT_CHARS = 40;

export function deriveAnchors(
  quote: string,
  snapshotText: string,
  quoteStart: number,
  sections: Section[],
): Anchors {
  const anchors: Anchors = {};
  const tokens = [...quote.matchAll(VARIABLE_TOKEN)];
  if (tokens.length > 0) {
    const first = tokens[0]!;
    const last = tokens[tokens.length - 1]!;
    const prefix = quote.slice(0, first.index).trim();
    const suffix = quote.slice(last.index! + last[0].length).replace(/^[\s.]+|[\s.]+$/g, '');
    if (prefix.length >= MIN_ANCHOR_CHARS) anchors.anchorPrefix = prefix;
    if (suffix.length >= MIN_ANCHOR_CHARS) anchors.anchorSuffix = suffix;
  } else {
    const words = quote.trim().split(/\s+/).slice(0, 6).join(' ');
    if (words.length >= MIN_ANCHOR_CHARS) anchors.anchorPrefix = words;
  }
  const ctxStart = Math.max(0, quoteStart - CONTEXT_CHARS);
  const ctx = snapshotText.slice(ctxStart, quoteStart);
  if (ctx.trim()) anchors.contextBefore = ctx;
  const heading = sectionAt(sections, quoteStart);
  if (heading) anchors.sectionHeading = heading;
  return anchors;
}
