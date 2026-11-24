import type { AuditEvent, ChangeEvent, Claim, Decision, Page, Snapshot, SupportEdge } from '../domain/types.ts';
import type { Clock, IdGenerator, Vault } from '../ports.ts';

/** In-memory adapters for tests and for running core logic without a browser. */
const clone = <T>(v: T): T => structuredClone(v);

class Table<T extends { id: string }> {
  private rows = new Map<string, T>();
  get = async (id: string) => (this.rows.has(id) ? clone(this.rows.get(id)!) : undefined);
  put = async (row: T) => void this.rows.set(row.id, clone(row));
  where = async (pred: (r: T) => boolean) => [...this.rows.values()].filter(pred).map(clone);
  all = async () => [...this.rows.values()].map(clone);
}

export function createMemoryVault(): Vault {
  const pages = new Table<Page>();
  const snapshots = new Table<Snapshot>();
  const claims = new Table<Claim>();
  const decisions = new Table<Decision>();
  const edges = new Table<SupportEdge>();
  const changes = new Table<ChangeEvent>();
  const audit: AuditEvent[] = [];
  return {
    pages: { get: pages.get, put: pages.put, findByUrl: async (u) => (await pages.where((p) => p.canonicalUrl === u))[0] },
    snapshots: { get: snapshots.get, put: snapshots.put },
    claims: { get: claims.get, put: claims.put, list: claims.all, listByPage: (id) => claims.where((c) => c.pageId === id) },
    decisions: { get: decisions.get, put: decisions.put, list: decisions.all },
    edges: {
      put: edges.put,
      listByClaim: (id) => edges.where((e) => e.claimId === id),
      listByDecision: (id) => edges.where((e) => e.decisionId === id),
    },
    changes: { get: changes.get, put: changes.put, listByClaim: (id) => changes.where((e) => e.claimId === id) },
    audit: {
      append: async (e) => void audit.push(clone(e)),
      listByDecision: async (id) => audit.filter((e) => e.decisionId === id).map(clone),
    },
  };
}

export class FixedClock implements Clock {
  constructor(public t = 1_700_000_000_000) {}
  now() { return this.t; }
  advance(ms = 1_000) { this.t += ms; }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  next() { return `id-${++this.n}`; }
}

export { webCryptoHasher } from '../infra/webCryptoHasher.ts';
