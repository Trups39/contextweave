import type { DecisionView } from './service.ts';

/**
 * Minimal payload for optional cloud review (PRD Journey C). Built from
 * selected evidence only: no snapshots, no full page text, no browsing history.
 * The UI shows exactly this object before the user consents.
 */
export interface ReviewPayload {
  instruction: string;
  decision: { question: string; selection: string; rationale?: string; status: string };
  evidence: {
    evidenceId: string;
    previousQuote: string;
    observedChange: string;
    currentExcerpt?: string;
    candidates?: string[];
  }[];
}

export function buildReviewPayload(view: DecisionView): ReviewPayload {
  const { decision } = view;
  return {
    instruction:
      'Compare previous and current source excerpts for this decision. Cite evidenceId values for every point. ' +
      'You cannot verify the websites yourself; reason only from these excerpts. ' +
      'Suggest whether the user should KEEP, REVISE, or RETIRE the decision, and why, in under 150 words.',
    decision: {
      question: decision.question,
      selection: decision.selection,
      ...(decision.rationale ? { rationale: decision.rationale } : {}),
      status: decision.status,
    },
    evidence: view.evidence.map(({ claim, edge, latestEvent }) => ({
      evidenceId: claim.id,
      previousQuote: claim.exactQuote,
      observedChange: latestEvent && edge.state !== 'PRESENT' ? latestEvent.observedDiff : 'UNCHANGED',
      ...(latestEvent?.currentExcerpt && edge.state !== 'PRESENT' ? { currentExcerpt: latestEvent.currentExcerpt } : {}),
      ...(latestEvent?.candidates && edge.state !== 'PRESENT' ? { candidates: latestEvent.candidates } : {}),
    })),
  };
}
