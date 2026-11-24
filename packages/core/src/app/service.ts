import { err, ok, type Result } from '../domain/result.ts';
import {
  isVerified, type AuditEvent, type ChangeEvent, type Claim, type Decision, type InferenceSource,
  type Page, type Snapshot, type SupportEdge,
} from '../domain/types.ts';
import { processCapture } from '../capture/pipeline.ts';
import { verifyQuote } from '../evidence/verification.ts';
import { deriveAnchors } from '../evidence/anchors.ts';
import { classifyRecheck, edgeStateFor, fingerprintOf, type RecheckOutcome } from '../evidence/recheck.ts';
import { applyDecisionCommand, type DecisionCommand } from '../decisions/stateMachine.ts';
import type { ClaimExtractor, Clock, CloudReviewer, Hasher, IdGenerator, RawCapture, Vault } from '../ports.ts';
import { buildReviewPayload, type ReviewPayload } from './reviewPayload.ts';
import { searchVault, type SearchHit } from './search.ts';

/**
 * Application service: orchestrates use cases over the ports. It owns no
 * rules of its own — verification, classification and lifecycle live in pure
 * modules — it only sequences reads, pure decisions, and writes.
 *
 * Trade-off: writes are not transactional across repositories. For a
 * single-user, single-tab extension that is acceptable for the MVP; every
 * write is idempotent by id, so a retried use case converges.
 */
export interface ServiceDeps {
  vault: Vault;
  clock: Clock;
  ids: IdGenerator;
  hasher: Hasher;
}

export interface SaveEvidenceResult {
  page: Page;
  snapshot: Snapshot;
  snapshotReused: boolean;
  claims: Claim[];
  inferenceSource?: InferenceSource;
  latencyMs: number;
}

export interface RecheckItem {
  claim: Claim;
  outcome: RecheckOutcome;
  event?: ChangeEvent;
  newEvent: boolean;
}

export interface RecheckResult {
  page: Page;
  snapshot: Snapshot;
  snapshotReused: boolean;
  items: RecheckItem[];
  flaggedDecisionIds: string[];
}

export interface DecisionView {
  decision: Decision;
  evidence: { edge: SupportEdge; claim: Claim; latestEvent?: ChangeEvent }[];
  pendingEvents: ChangeEvent[];
  audit: AuditEvent[];
}

export class ContextWeaveService {
  constructor(private readonly deps: ServiceDeps) {}

  private get vault() { return this.deps.vault; }
  private now() { return this.deps.clock.now(); }
  private id() { return this.deps.ids.next(); }

  // ---------------- Capture ----------------

  /** Pipeline + hashing + page identity. Identical content reuses the latest snapshot. */
  async captureSnapshot(raw: RawCapture): Promise<Result<{ page: Page; snapshot: Snapshot; reused: boolean }>> {
    const processed = processCapture(raw);
    if (!processed.ok) return processed;
    const { canonicalUrl, cleanText, sections } = processed.value;
    const sha256 = await this.deps.hasher.sha256Hex(cleanText);

    let page = await this.vault.pages.findByUrl(canonicalUrl);
    if (!page) {
      page = { id: this.id(), canonicalUrl };
      await this.vault.pages.put(page);
    }
    if (page.latestSnapshotId) {
      const latest = await this.vault.snapshots.get(page.latestSnapshotId);
      if (latest?.sha256 === sha256) return ok({ page, snapshot: latest, reused: true });
    }
    const snapshot: Snapshot = {
      id: this.id(), pageId: page.id, url: raw.url, title: raw.title.trim() || canonicalUrl,
      capturedAt: this.now(), cleanText, sha256, sections,
    };
    await this.vault.snapshots.put(snapshot);
    page = { ...page, latestSnapshotId: snapshot.id };
    await this.vault.pages.put(page);
    return ok({ page, snapshot, reused: false });
  }

  // ---------------- Journey A: save evidence ----------------

  async saveEvidence(raw: RawCapture, extractor: ClaimExtractor): Promise<Result<SaveEvidenceResult>> {
    const cap = await this.captureSnapshot(raw);
    if (!cap.ok) return cap;
    const { page, snapshot, reused } = cap.value;

    const extracted = await extractor.extract({
      text: snapshot.cleanText,
      ...(raw.selection ? { selection: raw.selection } : {}),
    });
    if (!extracted.ok) return extracted;
    const { candidates, inferenceSource, latencyMs } = extracted.value;

    const existing = new Set((await this.vault.claims.listByPage(page.id))
      .filter((c) => c.snapshotId === snapshot.id).map((c) => c.exactQuote));

    const claims: Claim[] = [];
    for (const cand of candidates) {
      if (existing.has(cand.quote)) continue;
      const v = verifyQuote(snapshot.cleanText, cand.quote);
      const anchors = v.match ? deriveAnchors(cand.quote, snapshot.cleanText, v.match.start, snapshot.sections) : {};
      const claim: Claim = {
        id: this.id(), snapshotId: snapshot.id, pageId: page.id,
        exactQuote: cand.quote, summary: cand.summary || cand.quote,
        ...anchors,
        verification: v.status,
        captureMethod: extractor.method,
        ...(extractor.method === 'MODEL' && inferenceSource ? { inferenceSource } : {}),
        createdAt: this.now(),
      };
      await this.vault.claims.put(claim);
      claims.push(claim);
    }
    return ok({
      page, snapshot, snapshotReused: reused, claims, latencyMs,
      ...(inferenceSource ? { inferenceSource } : {}),
    });
  }

  // ---------------- Journey B: decisions ----------------

  async createDecision(input: { question: string; selection: string; rationale?: string; claimIds?: string[] }): Promise<Result<Decision>> {
    if (!input.question.trim() || !input.selection.trim()) {
      return err('INVALID_INPUT', 'A decision needs a question and a selected option.');
    }
    const now = this.now();
    const decision: Decision = {
      id: this.id(), question: input.question.trim(), selection: input.selection.trim(),
      ...(input.rationale?.trim() ? { rationale: input.rationale.trim() } : {}),
      status: 'SUPPORTED', supportingClaimIds: [], pendingChangeEventIds: [], acknowledgedChangeEventIds: [],
      createdAt: now, updatedAt: now,
    };
    await this.vault.decisions.put(decision);
    await this.vault.audit.append({ id: this.id(), decisionId: decision.id, action: 'CREATED', timestamp: now, after: { selection: decision.selection, ...(decision.rationale ? { rationale: decision.rationale } : {}), supportingClaimIds: [] } });
    let current = decision;
    for (const claimId of input.claimIds ?? []) {
      const linked = await this.linkClaim(current.id, claimId);
      if (!linked.ok) return linked;
      current = linked.value;
    }
    return ok(current);
  }

  /** Only verified claims may support a decision (FR-03). */
  async linkClaim(decisionId: string, claimId: string): Promise<Result<Decision>> {
    const [decision, claim] = await Promise.all([this.vault.decisions.get(decisionId), this.vault.claims.get(claimId)]);
    if (!decision) return err('NOT_FOUND', `Decision ${decisionId} not found.`);
    if (!claim) return err('NOT_FOUND', `Claim ${claimId} not found.`);
    if (!isVerified(claim.verification)) {
      return err('UNVERIFIED_CLAIM', 'Unverified quotes cannot support a decision.');
    }
    if (decision.status === 'RETIRED') return err('ILLEGAL_TRANSITION', 'Retired decisions cannot gain evidence.');
    if (decision.supportingClaimIds.includes(claimId)) return ok(decision);
    await this.vault.edges.put({ id: this.id(), decisionId, claimId, state: 'NOT_CHECKED' });
    const updated: Decision = { ...decision, supportingClaimIds: [...decision.supportingClaimIds, claimId], updatedAt: this.now() };
    await this.vault.decisions.put(updated);
    return ok(updated);
  }

  // ---------------- Journey B: re-check ----------------

  async recheck(raw: RawCapture): Promise<Result<RecheckResult>> {
    const processed = processCapture(raw);
    if (!processed.ok) return processed;
    const known = await this.vault.pages.findByUrl(processed.value.canonicalUrl);
    if (!known) return err('NOT_FOUND', 'This page has no saved evidence yet. Save evidence first.');

    const cap = await this.captureSnapshot(raw);
    if (!cap.ok) return cap;
    const { page, snapshot, reused } = cap.value;
    const now = this.now();

    const items: RecheckItem[] = [];
    const flagged = new Set<string>();
    const claims = (await this.vault.claims.listByPage(page.id)).filter((c) => isVerified(c.verification));

    for (const claim of claims) {
      const edges = await this.vault.edges.listByClaim(claim.id);
      if (edges.length === 0) continue; // only evidence that supports a decision is tracked
      const outcome = classifyRecheck(claim, snapshot);
      const state = edgeStateFor(outcome.observedDiff);

      if (outcome.observedDiff === 'UNCHANGED') {
        for (const e of edges) await this.vault.edges.put({ ...e, state, lastCheckedSnapshotId: snapshot.id, lastCheckedAt: now });
        items.push({ claim, outcome, newEvent: false });
        continue;
      }

      const fingerprint = fingerprintOf(claim.id, outcome);
      const previous = latest(await this.vault.changes.listByClaim(claim.id));
      let event: ChangeEvent;
      let newEvent = false;
      if (previous?.fingerprint === fingerprint) {
        event = previous; // same relevant change seen before → no duplicate event
      } else {
        event = {
          id: this.id(), claimId: claim.id, oldSnapshotId: claim.snapshotId, newSnapshotId: snapshot.id,
          observedDiff: outcome.observedDiff, previousQuote: claim.exactQuote,
          ...(outcome.currentExcerpt !== undefined ? { currentExcerpt: outcome.currentExcerpt } : {}),
          ...(outcome.candidates ? { candidates: outcome.candidates } : {}),
          matchBasis: outcome.matchBasis, fingerprint, detectedAt: now,
        };
        await this.vault.changes.put(event);
        newEvent = true;
      }
      items.push({ claim, outcome, event, newEvent });

      for (const edge of edges) {
        await this.vault.edges.put({ ...edge, state, lastCheckedSnapshotId: snapshot.id, lastCheckedAt: now });
        if (edge.reviewedFingerprint === fingerprint) continue; // user already reviewed exactly this change
        const flaggedNow = await this.applyCommand(edge.decisionId, { type: 'FLAG', changeEventId: event.id, reason: outcome.reason });
        if (flaggedNow.ok && flaggedNow.value) flagged.add(edge.decisionId);
      }
    }
    return ok({ page, snapshot, snapshotReused: reused, items, flaggedDecisionIds: [...flagged] });
  }

  // ---------------- Journey C: resolution ----------------

  async resolve(decisionId: string, cmd: Exclude<DecisionCommand, { type: 'FLAG' }>): Promise<Result<Decision>> {
    if (cmd.type === 'REVISE' && cmd.supportingClaimIds) {
      for (const id of cmd.supportingClaimIds) {
        const c = await this.vault.claims.get(id);
        if (!c) return err('NOT_FOUND', `Claim ${id} not found.`);
        if (!isVerified(c.verification)) return err('UNVERIFIED_CLAIM', 'Unverified quotes cannot support a decision.');
      }
    }
    const r = await this.applyCommand(decisionId, cmd);
    if (!r.ok) return r;
    const decision = (await this.vault.decisions.get(decisionId))!;
    if (cmd.type === 'REVISE' && cmd.supportingClaimIds) {
      const edges = await this.vault.edges.listByDecision(decisionId);
      for (const id of cmd.supportingClaimIds) {
        if (!edges.some((e) => e.claimId === id)) {
          await this.vault.edges.put({ id: this.id(), decisionId, claimId: id, state: 'NOT_CHECKED' });
        }
      }
    }
    return ok(decision);
  }

  /** Applies a state-machine command and persists the result. Returns whether anything changed. */
  private async applyCommand(decisionId: string, cmd: DecisionCommand): Promise<Result<boolean>> {
    const d = await this.vault.decisions.get(decisionId);
    if (!d) return err('NOT_FOUND', `Decision ${decisionId} not found.`);
    const t = applyDecisionCommand(d, cmd, { now: this.now(), newId: () => this.id() });
    if (!t.ok) return t;
    if (t.value.decision === d) return ok(false);
    await this.vault.decisions.put(t.value.decision);
    for (const a of t.value.audit) await this.vault.audit.append(a);
    // Record what the user reviewed on each edge so the same change never re-flags (PRD v1.5).
    if (t.value.acknowledged.length > 0) {
      for (const edge of await this.vault.edges.listByDecision(decisionId)) {
        const reviewed = latest((await Promise.all(t.value.acknowledged.map((id) => this.vault.changes.get(id))))
          .filter((e): e is ChangeEvent => !!e && e.claimId === edge.claimId));
        if (reviewed) await this.vault.edges.put({ ...edge, reviewedFingerprint: reviewed.fingerprint });
      }
    }
    return ok(true);
  }

  // ---------------- Queries ----------------

  async getDecisionView(decisionId: string): Promise<Result<DecisionView>> {
    const decision = await this.vault.decisions.get(decisionId);
    if (!decision) return err('NOT_FOUND', `Decision ${decisionId} not found.`);
    const evidence: DecisionView['evidence'] = [];
    for (const edge of await this.vault.edges.listByDecision(decisionId)) {
      const claim = await this.vault.claims.get(edge.claimId);
      if (!claim) continue;
      const latestEvent = latest(await this.vault.changes.listByClaim(claim.id));
      evidence.push({ edge, claim, ...(latestEvent ? { latestEvent } : {}) });
    }
    const pendingEvents = (await Promise.all(decision.pendingChangeEventIds.map((id) => this.vault.changes.get(id))))
      .filter((e): e is ChangeEvent => !!e);
    const audit = await this.vault.audit.listByDecision(decisionId);
    return ok({ decision, evidence, pendingEvents, audit });
  }

  async search(query: string): Promise<SearchHit[]> {
    return searchVault(query, await this.vault.claims.list(), await this.vault.decisions.list());
  }

  // ---------------- Optional cloud review (P1) ----------------

  async buildReviewPayload(decisionId: string): Promise<Result<ReviewPayload>> {
    const view = await this.getDecisionView(decisionId);
    if (!view.ok) return view;
    return ok(buildReviewPayload(view.value));
  }

  /** Consent is a parameter, not a UI assumption: no consent → no request. */
  async cloudReview(reviewer: CloudReviewer, payload: ReviewPayload, consent: boolean) {
    if (!consent) return err('CONSENT_REQUIRED', 'Cloud review needs explicit consent.');
    return reviewer.review(JSON.stringify(payload));
  }
}

function latest<T extends { detectedAt: number }>(list: T[]): T | undefined {
  return list.reduce<T | undefined>((a, b) => (!a || b.detectedAt >= a.detectedAt ? b : a), undefined);
}
