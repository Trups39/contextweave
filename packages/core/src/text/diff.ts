/**
 * Word-level diff (LCS) for the before/after evidence view. Display-only:
 * classification never depends on it. Tokens keep their trailing whitespace
 * so joining a side's tokens reproduces that side's text exactly.
 */
export type DiffOp = { op: 'same' | 'del' | 'add'; text: string };

const tokenize = (s: string) => s.match(/\S+\s*/g) ?? [];

export function wordDiff(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const key = (t: string) => t.trim();
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = key(a[i]!) === key(b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffOp[] = [];
  const push = (op: DiffOp['op'], text: string) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]!) === key(b[j]!)) { push('same', b[j]!); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push('del', a[i++]!);
    else push('add', b[j++]!);
  }
  while (i < a.length) push('del', a[i++]!);
  while (j < b.length) push('add', b[j++]!);
  return out;
}
