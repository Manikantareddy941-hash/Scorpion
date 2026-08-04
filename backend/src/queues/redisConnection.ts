import IORedis from 'ioredis';
import { logger } from '../services/logger';

/**
 * Redis is not a cache here — it is the transport for every queue in
 * src/queues/ (scan, canary, dast, nuclei, ffuf, report, soar, correlation) and
 * the store behind imageStore's signature/provenance lookups. A process that
 * "connects" to the wrong Redis does not error; it accepts jobs that no worker
 * will ever see, which reads as a quiet system rather than a broken one.
 *
 * So the localhost default is development-only. In production an unset REDIS_URL
 * used to silently resolve to redis://localhost:6379 — on a hosted container
 * that is nothing at all, and the failure surfaced only as scans that never
 * completed. Refuse to boot instead.
 */
function resolveRedisUrl(): string {
    const configured = process.env.REDIS_URL;
    if (configured) return configured;

    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'REDIS_URL is not set. It has no safe default in production: every scan, ' +
            'canary, DAST and correlation queue rides on this connection, and falling ' +
            'back to redis://localhost:6379 would accept jobs no worker can ever read. ' +
            'Set REDIS_URL.',
        );
    }

    logger.warn('[Redis] REDIS_URL not set — defaulting to redis://localhost:6379 (non-production only).');
    return 'redis://localhost:6379';
}

const REDIS_URL = resolveRedisUrl();

export const redisConnection = new IORedis(REDIS_URL, {
    // Required by BullMQ: its blocking commands must not be given up on.
    maxRetriesPerRequest: null,
});

redisConnection.on('error', (err) => {
    logger.error('[Redis] Connection error:', err.message);
});
