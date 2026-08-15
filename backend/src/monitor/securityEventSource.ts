import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';
import type { SecurityEvent, SecurityEventType, Severity } from './securityEvent.types';

const COLLECTION = 'security_events';

/** Max events read per correlation window. Reaching it is reported, not silent. */
const WINDOW_EVENT_CAP = 500;

export async function recordSecurityEvent(e: Omit<SecurityEvent, 'id'>): Promise<void> {
  try {
    await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
      type: e.type, actor: e.actor ?? null, srcIp: e.srcIp ?? null,
      repoId: e.repoId ?? null, ownerUserId: e.ownerUserId, target: e.target ?? null,
      severity: e.severity, timestamp: e.timestamp, metadata: JSON.stringify(e.metadata ?? {}),
    });
  } catch (err) {
    logger.error('[securityEventSource] recordSecurityEvent failed', {
      event: 'SECURITY_EVENT_RECORD_FAILED',
      securityEventType: e.type,
      ownerUserId: e.ownerUserId,
      repoId: e.repoId,
      severity: e.severity,
      ...errorContext(err),
    });
  }
}

export async function collect(ownerUserId: string, windowMs: number): Promise<SecurityEvent[]> {
  const since = Date.now() - windowMs;
  try {
    const res = await databases.listDocuments(DB_ID, COLLECTION, [
      Query.equal('ownerUserId', ownerUserId),
      Query.greaterThanEqual('timestamp', since),
      Query.orderDesc('timestamp'), Query.limit(WINDOW_EVENT_CAP),
    ]);

    // Deliberately capped rather than exhaustive — this is a time-boxed read and
    // an unbounded window could be enormous. But the cap bites hardest exactly
    // when it matters: a brute-force or scanning burst produces the most events,
    // so the busier the window the more likely correlation silently misses the
    // tail. Say so instead of quietly evaluating rules on a partial window.
    if (res.documents.length >= WINDOW_EVENT_CAP) {
      logger.warn('[securityEventSource] window hit the event cap — correlation sees a partial window', {
        event: 'read_truncated', source: 'security_events', ownerUserId,
        cap: WINDOW_EVENT_CAP, total: res.total, windowMs,
      });
    }
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
    logger.error('[securityEventSource] collect failed', {
      event: 'SECURITY_EVENT_COLLECT_FAILED',
      ownerUserId,
      windowMs,
      ...errorContext(err),
    });
    return [];
  }
}

export const securityEventSource = { collect };
