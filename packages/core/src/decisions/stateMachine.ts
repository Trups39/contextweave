import type { AuditEvent, Decision, DecisionSnapshot, DecisionStatus } from '../domain/types.ts';
import { err, ok, type Result } from '../domain/result.ts';

/**
 * Decision lifecycle (PRD v1.5, 06-C) as an explicit state machine.
 * Every transition returns the next Decision plus the audit events to append;
 * nothing here mutates inputs or touches storage.
 *
 *   SUPPORTED ──FLAG──▶ NEEDS_REVIEW ──KEEP──▶ SUPPORTED
 *   REVISED   ──FLAG──▶ NEEDS_REVIEW ──REVISE─▶ REVISED
 *   any (not RETIRED) ──REVISE──▶ REVISED
 *   any (not RETIRED) ──RETIRE──▶ RETIRED   (terminal; FLAG is a no-op)
 *
 * NEEDS_REVIEW is never auto-cleared: only KEEP / REVISE / RETIRE leave it.
 */
export type DecisionCommand =
  | { type: 'FLAG'; changeEventId: string; reason: string }
  | { type: 'KEEP'; note?: string }
  | { type: 'REVISE'; selection: string; rationale?: string; supportingClaimIds?: string[]; note?: string }
  | { type: 'RETIRE'; note?: string };

export interface TransitionContext {
  now: number;
  newId: () => string;
}

export interface Transition {
  decision: Decision;
  audit: AuditEvent[];
  /** Change events resolved by this transition (to record on support edges). */
  acknowledged: string[];
}

const ALLOWED: Record<DecisionCommand['type'], readonly DecisionStatus[]> = {
  FLAG: ['SUPPORTED', 'NEEDS_REVIEW', 'REVISED', 'RETIRED'], // RETIRED handled as no-op
  KEEP: ['NEEDS_REVIEW'],
  REVISE: ['SUPPORTED', 'NEEDS_REVIEW', 'REVISED'],
  RETIRE: ['SUPPORTED', 'NEEDS_REVIEW', 'REVISED'],
};

export const snapshotOf = (d: Decision): DecisionSnapshot => ({
  selection: d.selection,
  ...(d.rationale !== undefined ? { rationale: d.rationale } : {}),
  supportingClaimIds: [...d.supportingClaimIds],
});

export function canApply(d: Decision, type: DecisionCommand['type']): boolean {
  return ALLOWED[type].includes(d.status);
}

export function applyDecisionCommand(d: Decision, cmd: DecisionCommand, ctx: TransitionContext): Result<Transition> {
  if (!canApply(d, cmd.type)) {
    return err('ILLEGAL_TRANSITION', `Cannot ${cmd.type} a decision in status ${d.status}.`);
  }
  const audit = (partial: Omit<AuditEvent, 'id' | 'decisionId' | 'timestamp'>): AuditEvent => ({
    id: ctx.newId(),
    decisionId: d.id,
    timestamp: ctx.now,
    ...partial,
  });

  switch (cmd.type) {
    case 'FLAG': {
      const already =
        d.pendingChangeEventIds.includes(cmd.changeEventId) ||
        d.acknowledgedChangeEventIds.includes(cmd.changeEventId);
      if (d.status === 'RETIRED' || already) return ok({ decision: d, audit: [], acknowledged: [] });
      return ok({
        decision: {
          ...d,
          status: 'NEEDS_REVIEW',
          pendingChangeEventIds: [...d.pendingChangeEventIds, cmd.changeEventId],
          updatedAt: ctx.now,
        },
        audit: [audit({ action: 'FLAGGED_NEEDS_REVIEW', changeEventId: cmd.changeEventId, note: cmd.reason })],
        acknowledged: [],
      });
    }
    case 'KEEP': {
      const acknowledged = d.pendingChangeEventIds;
      return ok({
        decision: resolved(d, 'SUPPORTED', ctx.now),
        audit: [audit({ action: 'RESOLVED_KEPT', note: cmd.note ?? 'Kept after review.' })],
        acknowledged,
      });
    }
    case 'REVISE': {
      if (!cmd.selection.trim()) return err('INVALID_INPUT', 'A revised decision needs a selection.');
      const before = snapshotOf(d);
      const next: Decision = {
        ...resolved(d, 'REVISED', ctx.now),
        selection: cmd.selection.trim(),
        supportingClaimIds: cmd.supportingClaimIds ?? d.supportingClaimIds,
      };
      if (cmd.rationale !== undefined) next.rationale = cmd.rationale;
      return ok({
        decision: next,
        audit: [audit({ action: 'RESOLVED_REVISED', before, after: snapshotOf(next), ...(cmd.note ? { note: cmd.note } : {}) })],
        acknowledged: d.pendingChangeEventIds,
      });
    }
    case 'RETIRE':
      return ok({
        decision: resolved(d, 'RETIRED', ctx.now),
        audit: [audit({ action: 'RESOLVED_RETIRED', ...(cmd.note ? { note: cmd.note } : {}) })],
        acknowledged: d.pendingChangeEventIds,
      });
  }
}

function resolved(d: Decision, status: DecisionStatus, now: number): Decision {
  return {
    ...d,
    status,
    acknowledgedChangeEventIds: [...d.acknowledgedChangeEventIds, ...d.pendingChangeEventIds],
    pendingChangeEventIds: [],
    updatedAt: now,
    lastReviewedAt: now,
  };
}
