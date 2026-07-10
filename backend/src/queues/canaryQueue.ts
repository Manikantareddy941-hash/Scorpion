import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';
import type { CanaryWorkerPayload } from '../gitops/canaryService';

export const CANARY_QUEUE_NAME = 'canary-analysis';

export const canaryQueue = new Queue<CanaryWorkerPayload>(CANARY_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
    },
});

/**
 * Schedules one canary analysis tick after `delayMs`. Redis-backed (BullMQ),
 * so the analysis loop survives process restarts — the delayed job fires on
 * whichever replica hosts the worker. jobId dedupes a tick that gets enqueued
 * twice (e.g. a retried tick that already scheduled its successor).
 */
export const enqueueCanaryCheck = (payload: CanaryWorkerPayload, delayMs: number) => {
    return canaryQueue.add('canary-tick', payload, {
        delay: delayMs,
        jobId: `canary-${payload.canaryId}-${payload.tick}`,
    });
};
