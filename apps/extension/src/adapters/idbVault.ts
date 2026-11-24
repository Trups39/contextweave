import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AuditEvent, ChangeEvent, Claim, Decision, Page, Snapshot, SupportEdge, Vault,
} from '@contextweave/core';

/**
 * Repository adapter over IndexedDB. Serialization and indexes live here;
 * the core only sees the Vault interface. Bump DB_VERSION and extend
 * `upgrade` for schema changes — never mutate existing stores in place.
 */
interface CwSchema extends DBSchema {
  pages: { key: string; value: Page; indexes: { byUrl: string } };
  snapshots: { key: string; value: Snapshot };
  claims: { key: string; value: Claim; indexes: { byPage: string } };
  decisions: { key: string; value: Decision };
  edges: { key: string; value: SupportEdge; indexes: { byClaim: string; byDecision: string } };
  changes: { key: string; value: ChangeEvent; indexes: { byClaim: string } };
  audit: { key: string; value: AuditEvent; indexes: { byDecision: string } };
}

const DB_NAME = 'contextweave';
const DB_VERSION = 1;

export async function openVault(): Promise<Vault> {
  const db: IDBPDatabase<CwSchema> = await openDB<CwSchema>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore('pages', { keyPath: 'id' }).createIndex('byUrl', 'canonicalUrl', { unique: true });
      d.createObjectStore('snapshots', { keyPath: 'id' });
      d.createObjectStore('claims', { keyPath: 'id' }).createIndex('byPage', 'pageId');
      d.createObjectStore('decisions', { keyPath: 'id' });
      const edges = d.createObjectStore('edges', { keyPath: 'id' });
      edges.createIndex('byClaim', 'claimId');
      edges.createIndex('byDecision', 'decisionId');
      d.createObjectStore('changes', { keyPath: 'id' }).createIndex('byClaim', 'claimId');
      d.createObjectStore('audit', { keyPath: 'id' }).createIndex('byDecision', 'decisionId');
    },
  });

  return {
    pages: {
      get: (id) => db.get('pages', id),
      findByUrl: (u) => db.getFromIndex('pages', 'byUrl', u),
      put: async (p) => void (await db.put('pages', p)),
    },
    snapshots: {
      get: (id) => db.get('snapshots', id),
      put: async (s) => void (await db.put('snapshots', s)),
    },
    claims: {
      get: (id) => db.get('claims', id),
      list: () => db.getAll('claims'),
      listByPage: (id) => db.getAllFromIndex('claims', 'byPage', id),
      put: async (c) => void (await db.put('claims', c)),
    },
    decisions: {
      get: (id) => db.get('decisions', id),
      list: () => db.getAll('decisions'),
      put: async (d) => void (await db.put('decisions', d)),
    },
    edges: {
      listByClaim: (id) => db.getAllFromIndex('edges', 'byClaim', id),
      listByDecision: (id) => db.getAllFromIndex('edges', 'byDecision', id),
      put: async (e) => void (await db.put('edges', e)),
    },
    changes: {
      get: (id) => db.get('changes', id),
      listByClaim: (id) => db.getAllFromIndex('changes', 'byClaim', id),
      put: async (e) => void (await db.put('changes', e)),
    },
    audit: {
      // `add` (not `put`) enforces append-only: re-using an id throws.
      append: async (e) => void (await db.add('audit', e)),
      listByDecision: async (id) =>
        (await db.getAllFromIndex('audit', 'byDecision', id)).sort((a, b) => a.timestamp - b.timestamp),
    },
  };
}
