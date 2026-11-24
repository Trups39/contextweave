import { describe, expect, it } from 'vitest';
import { chunkText, locateQuote, normalize, splitSentences, wordDiff } from '../src/index.ts';

describe('normalize', () => {
  it('flattens smart quotes, NBSP and whitespace runs but not case or digits', () => {
    expect(normalize('  “Fast” API’s   limit 1,000 ')).toBe('"Fast" API\'s limit 1,000');
  });
});

describe('locateQuote', () => {
  it('prefers exact matches', () => {
    const [m] = locateQuote('a b. a b.', 'a b.');
    expect(m).toEqual({ start: 0, end: 4, basis: 'EXACT' });
  });
  it('maps normalized matches back to exact raw substrings', () => {
    const raw = 'Intro.\nThe “limit”  is 300.';
    const [m] = locateQuote(raw, 'The "limit" is 300.');
    expect(m?.basis).toBe('NORMALIZED');
    expect(raw.slice(m!.start, m!.end)).toBe('The “limit”  is 300.');
  });
  it('returns nothing for empty or absent quotes', () => {
    expect(locateQuote('abc', '')).toEqual([]);
    expect(locateQuote('abc', 'xyz')).toEqual([]);
  });
});

describe('splitSentences', () => {
  it('keeps numbers with commas and decimals intact and returns raw offsets', () => {
    const raw = 'Limit is 1,000 requests. Version 1.5 ships!\nNext line';
    const s = splitSentences(raw);
    expect(s.map((x) => x.text)).toEqual(['Limit is 1,000 requests.', 'Version 1.5 ships!', 'Next line']);
    for (const x of s) expect(raw.slice(x.start, x.end)).toBe(x.text);
  });
});

describe('chunkText', () => {
  it('packs paragraphs up to the limit and splits oversized ones', () => {
    expect(chunkText('aaa\nbbb\nccc', 7)).toEqual(['aaa\nbbb', 'ccc']);
    expect(chunkText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('rejects a non-positive size', () => {
    expect(() => chunkText('x', 0)).toThrow();
  });
});

describe('wordDiff', () => {
  it('isolates the changed value', () => {
    expect(wordDiff('Provider A rate limit is 1,000 requests/minute.', 'Provider A rate limit is 300 requests/minute.')).toEqual([
      { op: 'same', text: 'Provider A rate limit is ' },
      { op: 'del', text: '1,000 ' },
      { op: 'add', text: '300 ' },
      { op: 'same', text: 'requests/minute.' },
    ]);
  });
  it('handles empty sides', () => {
    expect(wordDiff('', 'new text')).toEqual([{ op: 'add', text: 'new text' }]);
    expect(wordDiff('old', '')).toEqual([{ op: 'del', text: 'old' }]);
  });
});
