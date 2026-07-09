import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { PostureFinding } from '../posture/postureChecks';

const COLLECTION = 'posture_snapshots';

export interface NamespaceSnapshot {
  namespace: string;
  score: number;
  findings: PostureFinding[];
  updatedAt: string;
}

interface SnapshotWire { namespace: string; score: number; findings: string; updatedAt: string }

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fromDoc(doc: Models.Document): NamespaceSnapshot {
  const w = doc as unknown as SnapshotWire & Models.Document;
  return {
    namespace: w.namespace,
    score: w.score,
    findings: JSON.parse(w.findings || '[]') as PostureFinding[],
    updatedAt: w.updatedAt,
  };
}

export const postureRepository = {
  /** Upsert one document per namespace. Never throws — a failed save loses one
   *  tick, not the scanner. */
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
        logger.warn(`[PostureRepository] save for '${ns.namespace}' failed:`,
          toMessage(err));
      }
    }
  },

  async listSnapshots(): Promise<NamespaceSnapshot[]> {
    const list = await databases.listDocuments(DB_ID, COLLECTION, [
      Query.orderDesc('updatedAt'), Query.limit(200),
    ]);
    return list.documents.map(fromDoc);
  },
};
