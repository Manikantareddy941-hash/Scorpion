import { VulnerablePackage } from './reachabilityService';
import { redisConnection } from '../queues/redisConnection';
import { logger } from './logger';

/**
 * Image digest → findings store. Written by the CI ingest endpoint, read by the
 * K8s admission webhook so the gate decides on real scan data instead of a stub.
 *
 * Primary: Redis (shared across replicas, native PX TTL eviction). Fallback: a
 * bounded process-local LRU Map used only while Redis is unreachable, so a
 * transient DB drop degrades to stale-but-available instead of denying every
 * webhook. Writes mirror to the Map so an in-flight drop still serves the data
 * the same process just stored.
 *
 * ponytail: Redis use is gated on `status === 'ready'` (not a try/connect race),
 * so unit tests with no server deterministically hit the Map fallback. The Map is
 * per-process and lost on restart — that's the fallback's known ceiling, Redis is
 * the durable cross-replica path.
 */
const KEY_PREFIX = 'scan:';
const MAX_ENTRIES = 1000;
const TTL_MS = 60 * 60 * 1000; // 1h — generous vs. CI build→admission gap.

interface Entry {
  packages: VulnerablePackage[];
  expiresAt: number;
}

const fallback = new Map<string, Entry>();

const redisReady = (): boolean => redisConnection.status === 'ready';
const toMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function putScan(digest: string, packages: VulnerablePackage[], now: number = Date.now()): Promise<void> {
  // Always mirror locally so a mid-flight Redis drop still serves what we just stored.
  putLocal(digest, packages, now);
  if (!redisReady()) return;
  try {
    await redisConnection.set(KEY_PREFIX + digest, JSON.stringify(packages), 'PX', TTL_MS);
  } catch (err) {
    logger.warn('[imageStore] redis put failed — kept local fallback', { digest, error: toMessage(err) });
  }
}

export async function getScan(digest: string, now: number = Date.now()): Promise<VulnerablePackage[] | undefined> {
  if (redisReady()) {
    try {
      const raw = await redisConnection.get(KEY_PREFIX + digest);
      if (raw !== null) return JSON.parse(raw) as VulnerablePackage[];
      // Redis up but key absent: fall through to local in case a Redis write failed.
    } catch (err) {
      logger.warn('[imageStore] redis get failed — serving local fallback', { digest, error: toMessage(err) });
    }
  }
  return getLocal(digest, now);
}

// --- process-local bounded LRU + lazy-TTL fallback ---------------------------
// Map iteration order is insertion order, so the first key is the LRU victim;
// delete-then-set moves a key to the tail to mark it most-recently-used.

function putLocal(digest: string, packages: VulnerablePackage[], now: number): void {
  fallback.delete(digest);
  while (fallback.size >= MAX_ENTRIES) {
    const oldest = fallback.keys().next().value;
    if (oldest === undefined) break;
    fallback.delete(oldest);
  }
  fallback.set(digest, { packages, expiresAt: now + TTL_MS });
}

function getLocal(digest: string, now: number): VulnerablePackage[] | undefined {
  const entry = fallback.get(digest);
  if (entry === undefined) return undefined;
  if (entry.expiresAt <= now) {
    fallback.delete(digest);
    return undefined;
  }
  fallback.delete(digest);
  fallback.set(digest, entry);
  return entry.packages;
}
