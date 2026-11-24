import { err, ok, type Result } from '../domain/result.ts';
import type { RawCapture } from '../ports.ts';

/**
 * Capture pipeline (chain of responsibility). Each step either returns the
 * enriched context or a typed failure that stops the chain:
 *
 *   requireUserInitiated → validateUrl → canonicalize → sanitize → requireContent
 *
 * Hashing happens after the chain (it is async and has no failure mode).
 */
export interface CaptureContext {
  raw: RawCapture;
  canonicalUrl: string;
  cleanText: string;
  sections: RawCapture['sections'];
}

export type Step = (ctx: CaptureContext) => Result<CaptureContext>;

export function runPipeline(ctx: CaptureContext, steps: readonly Step[]): Result<CaptureContext> {
  let current = ctx;
  for (const step of steps) {
    const r = step(current);
    if (!r.ok) return r;
    current = r.value;
  }
  return ok(current);
}

export const requireUserInitiated: Step = (ctx) =>
  ctx.raw.userInitiated ? ok(ctx) : err('INVALID_INPUT', 'Capture must be triggered by an explicit user action.');

export const validateUrl: Step = (ctx) => {
  let u: URL;
  try {
    u = new URL(ctx.raw.url);
  } catch {
    return err('UNSUPPORTED_URL', `Not a valid URL: ${ctx.raw.url}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return err('UNSUPPORTED_URL', `Only http(s) pages can be captured, not ${u.protocol}`);
  }
  return ok(ctx);
};

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|_gl$|ref_)/;

/**
 * Canonical identity = rel=canonical (same origin only) or the page URL, with
 * the fragment and tracking params removed. Other query params are kept: on
 * many docs sites they select real content (version, language).
 */
export const canonicalize: Step = (ctx) => {
  const page = new URL(ctx.raw.url);
  let chosen = page;
  if (ctx.raw.canonicalUrl) {
    try {
      const c = new URL(ctx.raw.canonicalUrl, page);
      if (c.origin === page.origin) chosen = c;
    } catch { /* ignore malformed canonical */ }
  }
  const u = new URL(chosen.href);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  return ok({ ...ctx, canonicalUrl: u.href });
};

/** Strip control chars, collapse intra-line whitespace, keep line breaks (sentence boundaries). */
export const sanitize: Step = (ctx) => {
  const MAX_CHARS = 500_000;
  const lines = ctx.raw.text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim());
  let cleanText = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (cleanText.length > MAX_CHARS) cleanText = cleanText.slice(0, MAX_CHARS);
  // Section offsets refer to the raw text; re-locate headings in clean text, in order.
  const sections: CaptureContext['sections'] = [];
  let from = 0;
  for (const s of ctx.raw.sections) {
    const heading = s.heading.replace(/\s+/g, ' ').trim();
    if (!heading) continue;
    const at = cleanText.indexOf(heading, from);
    if (at < 0) continue;
    sections.push({ heading, start: at });
    from = at + heading.length;
  }
  return ok({ ...ctx, cleanText, sections });
};

export const requireContent: Step = (ctx) =>
  ctx.cleanText.length > 0 ? ok(ctx) : err('EMPTY_CAPTURE', 'No visible text was captured from this page.');

export const DEFAULT_CAPTURE_STEPS: readonly Step[] = [
  requireUserInitiated, validateUrl, canonicalize, sanitize, requireContent,
];

export function processCapture(raw: RawCapture): Result<CaptureContext> {
  return runPipeline({ raw, canonicalUrl: raw.url, cleanText: raw.text, sections: raw.sections }, DEFAULT_CAPTURE_STEPS);
}
