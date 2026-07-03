import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';
import type { ZapWorkerPayload } from '../workers/zapWorker';

export const DAST_QUEUE_NAME = 'dast-execution';

export const dastQueue = new Queue<ZapWorkerPayload>(DAST_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
    },
});

/**
 * Enqueues a DAST scan to run on the background worker instead of inline in
 * the API request. Jobs survive process restarts and retry once on failure
 * (Redis-backed via BullMQ), unlike the previous fire-and-forget call.
 */
export const enqueueDastScan = (payload: ZapWorkerPayload) => {
    return dastQueue.add('dast', payload, { jobId: `dast-${payload.scanId}` });
};
