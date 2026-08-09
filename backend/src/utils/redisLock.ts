import crypto from 'crypto';
import { redisConnection } from '../queues/redisConnection';
import { logger, errorContext } from '../services/logger';

/**
 * Distributed lease lock (SET NX PX + compare-and-delete release) so mutually
 * exclusive work — an IaC plan/apply on one workspace — stays exclusive when
 * the backend runs more than one replica. Falls back to an in-process lock
 * when Redis isn't ready, preserving single-node behavior in dev.
 */

const localLocks = new Set<string>();

export interface LockHandle {
  key: string;
  token: string;
  local: boolean;
}

export async function acquireLock(key: string, ttlMs: number): Promise<LockHandle | null> {
  if (redisConnection.status !== 'ready') {
    if (localLocks.has(key)) return null;
    localLocks.add(key);
    return { key, token: 'local', local: true };
  }

  const token = crypto.randomUUID();
  const ok = await redisConnection.set(key, token, 'PX', ttlMs, 'NX');
  return ok === 'OK' ? { key, token, local: false } : null;
}

// Only delete the key if we still own it — a lease that expired and was
// re-acquired by another replica must not be released by the old holder.
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export async function releaseLock(handle: LockHandle): Promise<void> {
  if (handle.local) {
    localLocks.delete(handle.key);
    return;
  }
  try {
    await redisConnection.eval(RELEASE_SCRIPT, 1, handle.key, handle.token);
  } catch (err) {
    // Lease TTL is the backstop: an unreleasable lock frees itself.
    // `handle.key` only — never `handle.token`, which is the nonce proving
    // ownership of the lease; logging it would let a reader release someone
    // else's lock.
    logger.warn(`[RedisLock] Release failed for ${handle.key}`, {
      event: 'REDIS_LOCK_RELEASE_FAILED', lockKey: handle.key, ...errorContext(err),
    });
  }
}
