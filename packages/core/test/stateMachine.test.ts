import { describe, expect, it } from 'vitest';
import { applyDecisionCommand, type Decision, type DecisionCommand } from '../src/index.ts';

let n = 0;
const ctx = { now: 10, newId: () => `a${++n}` };
const base: Decision = {
  id: 'd1', question: 'Which provider?', selection: 'Provider A', rationale: '1,000 rpm is enough',
  status: 'SUPPORTED', supportingClaimIds: ['c1'], pendingChangeEventIds: [], acknowledgedChangeEventIds: [],
  createdAt: 0, updatedAt: 0,
};
const run = (d: Decision, cmd: DecisionCommand) => {
  const r = applyDecisionCommand(d, cmd, ctx);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const flag = (id: string): DecisionCommand => ({ type: 'FLAG', changeEventId: id, reason: 'changed' });

describe('decision state machine', () => {
  it('FLAG moves SUPPORTED → NEEDS_REVIEW with one audit event', () => {
    const t = run(base, flag('e1'));
    expect(t.decision.status).toBe('NEEDS_REVIEW');
    expect(t.decision.pendingChangeEventIds).toEqual(['e1']);
    expect(t.audit.map((a) => a.action)).toEqual(['FLAGGED_NEEDS_REVIEW']);
  });

  it('FLAG for an already pending or acknowledged event is a no-op', () => {
    const flagged = run(base, flag('e1')).decision;
    const again = run(flagged, flag('e1'));
    expect(again.decision).toBe(flagged);
    expect(again.audit).toEqual([]);
    const kept = run(flagged, { type: 'KEEP' }).decision;
    expect(run(kept, flag('e1')).decision).toBe(kept);
  });

  it('KEEP restores SUPPORTED and acknowledges pending events', () => {
    const t = run(run(base, flag('e1')).decision, { type: 'KEEP' });
    expect(t.decision.status).toBe('SUPPORTED');
    expect(t.decision.acknowledgedChangeEventIds).toEqual(['e1']);
    expect(t.decision.pendingChangeEventIds).toEqual([]);
    expect(t.acknowledged).toEqual(['e1']);
    expect(t.audit[0]?.action).toBe('RESOLVED_KEPT');
  });

  it('T25 REVISE stores immutable before/after snapshots', () => {
    const t = run(run(base, flag('e1')).decision, {
      type: 'REVISE', selection: 'Provider B', rationale: 'A dropped to 300 rpm', supportingClaimIds: ['c2'],
    });
    expect(t.decision.status).toBe('REVISED');
    expect(t.audit[0]?.before).toEqual({ selection: 'Provider A', rationale: '1,000 rpm is enough', supportingClaimIds: ['c1'] });
    expect(t.audit[0]?.after).toEqual({ selection: 'Provider B', rationale: 'A dropped to 300 rpm', supportingClaimIds: ['c2'] });
  });

  it('T11 RETIRED is terminal: FLAG is ignored, other commands rejected', () => {
    const retired = run(base, { type: 'RETIRE' }).decision;
    expect(run(retired, flag('e9')).decision).toBe(retired);
    for (const cmd of [{ type: 'KEEP' }, { type: 'RETIRE' }, { type: 'REVISE', selection: 'X' }] as DecisionCommand[]) {
      const r = applyDecisionCommand(retired, cmd, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('ILLEGAL_TRANSITION');
    }
  });

  it('rejects KEEP when nothing is under review, and REVISE with an empty selection', () => {
    expect(applyDecisionCommand(base, { type: 'KEEP' }, ctx).ok).toBe(false);
    const r = applyDecisionCommand(base, { type: 'REVISE', selection: '  ' }, ctx);
    expect(!r.ok && r.error.code).toBe('INVALID_INPUT');
  });

  it('does not mutate its input', () => {
    const copy = structuredClone(base);
    run(base, flag('e1'));
    expect(base).toEqual(copy);
  });
});
