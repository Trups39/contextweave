/**
 * Domain contracts for ContextWeave (PRD v1.5, section 05).
 *
 * Two status dimensions are deliberately separate:
 *  - VerificationStatus: was the quote verbatim in its ORIGINAL capture?
 *  - ObservedDiff / EvidenceStatus: what did a LATER re-check observe?
 * DecisionStatus is a third, human-owned dimension: a user may KEEP a decision
 * (SUPPORTED) while its evidence edge still reads CHANGED.
 */

export type VerificationStatus = 'VERIFIED_EXACT' | 'VERIFIED_NORMALIZED' | 'UNVERIFIED';
export type DecisionStatus = 'SUPPORTED' | 'NEEDS_REVIEW' | 'REVISED' | 'RETIRED';
export type EvidenceStatus = 'NOT_CHECKED' | 'PRESENT' | 'CHANGED' | 'MISSING' | 'AMBIGUOUS';
export type ObservedDiff = 'UNCHANGED' | 'TEXT_CHANGED' | 'MISSING' | 'AMBIGUOUS';
export type InferenceSource = 'ON_DEVICE' | 'IN_CLOUD';
export type CaptureMethod = 'MODEL' | 'MANUAL';
export type MatchBasis = 'EXACT' | 'NORMALIZED' | 'ANCHOR' | 'NONE';

/** A heading found in the captured page and where its section starts in cleanText. */
export interface Section {
  heading: string;
  start: number;
}

export interface Page {
  id: string;
  canonicalUrl: string;
  latestSnapshotId?: string;
}

export interface Snapshot {
  id: string;
  pageId: string;
  url: string;
  title: string;
  capturedAt: number;
  cleanText: string;
  sha256: string;
  /** Headings in document order; used for section-aware matching (PRD 06-B). */
  sections: Section[];
}

export interface Claim {
  id: string;
  snapshotId: string;
  pageId: string;
  exactQuote: string;
  summary: string;
  anchorPrefix?: string;
  anchorSuffix?: string;
  contextBefore?: string;
  sectionHeading?: string;
  verification: VerificationStatus;
  captureMethod: CaptureMethod;
  /** Absent for MANUAL claims: never show a model badge that did not run. */
  inferenceSource?: InferenceSource;
  createdAt: number;
}

export interface Decision {
  id: string;
  question: string;
  selection: string;
  rationale?: string;
  status: DecisionStatus;
  supportingClaimIds: string[];
  /** Change events that flagged this decision and still await a human resolution. */
  pendingChangeEventIds: string[];
  acknowledgedChangeEventIds: string[];
  createdAt: number;
  updatedAt: number;
  lastReviewedAt?: number;
}

export interface SupportEdge {
  id: string;
  decisionId: string;
  claimId: string;
  state: EvidenceStatus;
  lastCheckedSnapshotId?: string;
  lastCheckedAt?: number;
  /** Fingerprint the user last acknowledged (KEEP/REVISE). See recheck/fingerprint.ts. */
  reviewedFingerprint?: string;
}

export interface ChangeEvent {
  id: string;
  claimId: string;
  oldSnapshotId: string;
  newSnapshotId: string;
  observedDiff: Exclude<ObservedDiff, 'UNCHANGED'>;
  previousQuote: string;
  currentExcerpt?: string;
  /** Other candidate sentences when AMBIGUOUS; each is an exact substring of the new snapshot. */
  candidates?: string[];
  matchBasis: MatchBasis;
  fingerprint: string;
  detectedAt: number;
}

export interface DecisionSnapshot {
  selection: string;
  rationale?: string;
  supportingClaimIds: string[];
}

export type AuditAction =
  | 'CREATED'
  | 'FLAGGED_NEEDS_REVIEW'
  | 'RESOLVED_KEPT'
  | 'RESOLVED_REVISED'
  | 'RESOLVED_RETIRED';

export interface AuditEvent {
  id: string;
  decisionId: string;
  changeEventId?: string;
  action: AuditAction;
  timestamp: number;
  before?: DecisionSnapshot;
  after?: DecisionSnapshot;
  note?: string;
}

export const isVerified = (v: VerificationStatus): boolean => v !== 'UNVERIFIED';
