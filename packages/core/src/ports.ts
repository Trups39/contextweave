import type {
  AuditEvent, ChangeEvent, Claim, Decision, InferenceSource, Page, Section, Snapshot, SupportEdge,
} from './domain/types.ts';
import type { Result } from './domain/result.ts';

/**
 * Ports (hexagonal architecture). Core logic depends only on these
 * interfaces; the extension provides IndexedDB / Chrome / Firebase adapters,
 * tests provide in-memory ones.
 */

// ---------- Repositories ----------

export interface PageRepository {
  get(id: string): Promise<Page | undefined>;
  findByUrl(canonicalUrl: string): Promise<Page | undefined>;
  put(page: Page): Promise<void>;
}
export interface SnapshotRepository {
  get(id: string): Promise<Snapshot | undefined>;
  put(s: Snapshot): Promise<void>;
}
export interface ClaimRepository {
  get(id: string): Promise<Claim | undefined>;
  listByPage(pageId: string): Promise<Claim[]>;
  list(): Promise<Claim[]>;
  put(c: Claim): Promise<void>;
}
export interface DecisionRepository {
  get(id: string): Promise<Decision | undefined>;
  list(): Promise<Decision[]>;
  put(d: Decision): Promise<void>;
}
export interface SupportEdgeRepository {
  listByClaim(claimId: string): Promise<SupportEdge[]>;
  listByDecision(decisionId: string): Promise<SupportEdge[]>;
  put(e: SupportEdge): Promise<void>;
}
export interface ChangeEventRepository {
  get(id: string): Promise<ChangeEvent | undefined>;
  listByClaim(claimId: string): Promise<ChangeEvent[]>;
  put(e: ChangeEvent): Promise<void>;
}
/** Append-only by contract: there is no update or delete. */
export interface AuditLog {
  append(e: AuditEvent): Promise<void>;
  listByDecision(decisionId: string): Promise<AuditEvent[]>;
}

export interface Vault {
  pages: PageRepository;
  snapshots: SnapshotRepository;
  claims: ClaimRepository;
  decisions: DecisionRepository;
  edges: SupportEdgeRepository;
  changes: ChangeEventRepository;
  audit: AuditLog;
}

// ---------- Infrastructure ----------

export interface Clock { now(): number }
export interface IdGenerator { next(): string }
export interface Hasher { sha256Hex(text: string): Promise<string> }

/** Raw capture produced by the browser adapter after an explicit user click. */
export interface RawCapture {
  url: string;
  canonicalUrl?: string;
  title: string;
  text: string;
  sections: Section[];
  selection?: string;
  userInitiated: boolean;
}

// ---------- Extraction strategies ----------

export interface CandidateClaim {
  quote: string;
  summary: string;
}

export interface ExtractionOutput {
  candidates: CandidateClaim[];
  /** Read from the SDK response, never from the requested mode. Undefined for MANUAL. */
  inferenceSource?: InferenceSource;
  latencyMs: number;
}

export interface ExtractionInput {
  text: string;
  selection?: string;
}

/**
 * Strategy: interchangeable ways to propose claims. `method` decides how the
 * resulting claims are labeled (MODEL vs MANUAL badge).
 */
export interface ClaimExtractor {
  readonly method: 'MODEL' | 'MANUAL';
  extract(input: ExtractionInput): Promise<Result<ExtractionOutput>>;
}

/** Cloud reviewer strategy; only ever called with a consented payload. */
export interface CloudReviewer {
  review(payloadJson: string): Promise<Result<{ text: string; inferenceSource?: InferenceSource; latencyMs: number }>>;
}
