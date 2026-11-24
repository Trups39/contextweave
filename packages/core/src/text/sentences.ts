/**
 * Deterministic sentence segmentation. Boundaries are line breaks or
 * [.!?] followed by whitespace, so "1,000" and "1.5" stay inside a sentence.
 * Returned ranges index the raw text, so every sentence is an exact substring.
 */
export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

export function splitSentences(raw: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const boundary = /[.!?](?=\s)|\n/g;
  let start = 0;
  const push = (s: number, e: number) => {
    // Trim without losing raw offsets.
    while (s < e && /\s/.test(raw[s]!)) s++;
    while (e > s && /\s/.test(raw[e - 1]!)) e--;
    if (e > s) spans.push({ text: raw.slice(s, e), start: s, end: e });
  };
  for (let m = boundary.exec(raw); m; m = boundary.exec(raw)) {
    const end = m[0] === '\n' ? m.index : m.index + 1;
    push(start, end);
    start = m.index + 1;
  }
  push(start, raw.length);
  return spans;
}

/** Split long text into chunks at paragraph boundaries, each <= maxChars when possible. */
export function chunkText(raw: string, maxChars: number): string[] {
  if (maxChars <= 0) throw new Error('maxChars must be positive');
  const paragraphs = raw.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (p.length > maxChars) {
      if (current) chunks.push(current);
      current = '';
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      continue;
    }
    if (current && current.length + 1 + p.length > maxChars) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
