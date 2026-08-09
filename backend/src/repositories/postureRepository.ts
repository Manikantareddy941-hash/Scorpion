import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger, errorContext, errorMessage } from '../services/logger';
import type { PostureFinding } from '../posture/postureChecks';
import { isPostgresEnabled } from '../db/pool';
import { posturePgRepository } from './pg/posturePgRepository';

const COLLECTION = 'posture_snapshots';

export interface NamespaceSnapshot {
  namespace: string;
  score: number;
  findings: PostureFinding[];
  updatedAt: string;
}

interface SnapshotWire { namespace: string; score: number; findings: string; updatedAt: string }

/** null for malformed rows (bad findings JSON) — skip the row, keep siblings. */
function fromDoc(doc: Models.Document): NamespaceSnapshot | null {
  const w = doc as unknown as SnapshotWire & Models.Document;
  try {
    return {
      namespace: w.namespace,
      score: w.score,
      findings: JSON.parse(w.findings || '[]') as PostureFinding[],
      updatedAt: w.updatedAt,
    };
  } catch (err) {
    logger.warn(`[PostureRepository] skipping snapshot ${doc.$id}: ${errorMessage(err)}`);
    return null;
  }
}

const legacyPostureRepository = {
  // Mutations log with context then rethrow — silent fake success is data
  // loss; the scanner tick catches so the interval loop never crashes.
  async saveSnapshot(namespaces: { namespace: string; score: number; findings: PostureFinding[] }[]): Promise<void> {
    const updatedAt = new Date().toISOString();
    for (const ns of namespaces) {
      const payload = {
        namespace: ns.namespace,
        score: ns.score,
        findings: JSON.stringify(ns.findings),
        updatedAt,
      };
      try {
        const existing = await databases.listDocuments(DB_ID, COLLECTION, [
          Query.equal('namespace', ns.namespace), Query.limit(1),
        ]);
        if (existing.documents.length > 0) {
          await databases.updateDocument(DB_ID, COLLECTION, existing.documents[0].$id, payload);
        } else {
          await databases.createDocument(DB_ID, COLLECTION, ID.unique(), payload);
        }
      } catch (err) {
        logger.error(`[PostureRepository] save for '${ns.namespace}' failed`, {
          event: 'POSTURE_SNAPSHOT_WRITE_FAILED', namespace: ns.namespace, ...errorContext(err),
        });
        throw err;
      }
    }
  },

  /** [] on failure — a read outage must not take the posture read path down. */
  async listSnapshots(): Promise<NamespaceSnapshot[]> {
    try {
      const list = await databases.listDocuments(DB_ID, COLLECTION, [
        Query.orderDesc('updatedAt'), Query.limit(200),
      ]);
      return list.documents.map(fromDoc).filter((s): s is NamespaceSnapshot => s !== null);
    } catch (err) {
      logger.warn('[PostureRepository] list failed', { event: 'POSTURE_SNAPSHOT_LIST_FAILED', ...errorContext(err) });
      return [];
    }
  },
};

// posturePgRepository imports NamespaceSnapshot from this module (type-only, so
// the top-level value import above creates no runtime cycle).
/** Storage facade: Postgres when DATABASE_URL is configured, legacy Appwrite otherwise. */
export const postureRepository: typeof legacyPostureRepository =
  isPostgresEnabled() ? posturePgRepository : legacyPostureRepository;
