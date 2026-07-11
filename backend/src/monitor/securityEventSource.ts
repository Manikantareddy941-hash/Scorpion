import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { SecurityEvent, SecurityEventType, Severity } from './securityEvent.types';

const COLLECTION = 'security_events';

export async function recordSecurityEvent(e: Omit<SecurityEvent, 'id'>): Promise<void> {
  try {
    await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
      type: e.type, actor: e.actor ?? null, srcIp: e.srcIp ?? null,
      repoId: e.repoId ?? null, ownerUserId: e.ownerUserId, target: e.target ?? null,
      severity: e.severity, timestamp: e.timestamp, metadata: JSON.stringify(e.metadata ?? {}),
    });
  } catch (err) {
    logger.error('[securityEventSource] recordSecurityEvent failed', err);
  }
}

export async function collect(ownerUserId: string, windowMs: number): Promise<SecurityEvent[]> {
  const since = Date.now() - windowMs;
  try {
    const res = await databases.listDocuments(DB_ID, COLLECTION, [
      Query.equal('ownerUserId', ownerUserId),
      Query.greaterThanEqual('timestamp', since),
      Query.orderDesc('timestamp'), Query.limit(500),
    ]);
    return res.documents.map((d) => {
      const w = d as unknown as Record<string, string | number>;
      return {
        id: d.$id, type: w.type as SecurityEventType, actor: (w.actor as string) || undefined,
        srcIp: (w.srcIp as string) || undefined, repoId: (w.repoId as string) || undefined,
        ownerUserId: w.ownerUserId as string, target: (w.target as string) || undefined,
        severity: w.severity as Severity, timestamp: Number(w.timestamp),
        metadata: JSON.parse((w.metadata as string) || '{}'),
      };
    });
  } catch (err) {
    logger.error('[securityEventSource] collect failed', err);
    return [];
  }
}

export const securityEventSource = { collect };
