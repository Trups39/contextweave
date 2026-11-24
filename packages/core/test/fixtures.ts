import type { RawCapture, Section, Snapshot } from '../src/index.ts';
import { ContextWeaveService } from '../src/index.ts';
import { createMemoryVault, FixedClock, SequentialIds, webCryptoHasher } from '../src/testing/memoryVault.ts';

export const URL_DOCS = 'https://contextweave-demo.web.app/docs';
export const V1_QUOTE = 'Provider A rate limit is 1,000 requests/minute.';

/** Builds page text plus heading offsets, like the browser capture adapter does. */
export function page(blocks: { heading?: string; lines: string[] }[]): { text: string; sections: Section[] } {
  let text = '';
  const sections: Section[] = [];
  for (const b of blocks) {
    if (b.heading) {
      sections.push({ heading: b.heading, start: text.length });
      text += `${b.heading}\n`;
    }
    text += `${b.lines.join('\n')}\n\n`;
  }
  return { text, sections };
}

export function docs(limit: string, opts: { footer?: string; changelog?: string[] } = {}): RawCapture {
  const p = page([
    { heading: 'Provider A API', lines: ['Overview of the ingestion API.'] },
    { heading: 'Rate limits', lines: [`Provider A rate limit is ${limit} requests/minute.`, 'Bursts are smoothed over 10 seconds.'] },
    ...(opts.changelog ? [{ heading: 'Changelog', lines: opts.changelog }] : []),
    { heading: 'Footer', lines: [opts.footer ?? '© 2026 Provider A (fictional).'] },
  ]);
  return { url: URL_DOCS, title: 'Provider A Docs', userInitiated: true, ...p };
}

export function snapshotOf(raw: { text: string; sections: Section[] }): Snapshot {
  return {
    id: 'snap-x', pageId: 'page-x', url: URL_DOCS, title: 't', capturedAt: 0,
    cleanText: raw.text, sha256: 'x', sections: raw.sections,
  };
}

export function setup() {
  const vault = createMemoryVault();
  const clock = new FixedClock();
  const service = new ContextWeaveService({ vault, clock, ids: new SequentialIds(), hasher: webCryptoHasher });
  return { vault, clock, service };
}
