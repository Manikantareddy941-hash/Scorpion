import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';
import type { NucleiWorkerPayload } from '../workers/nucleiWorker';

export const NUCLEI_QUEUE_NAME = 'nuclei-execution';

export const nucleiQueue = new Queue<NucleiWorkerPayload>(NUCLEI_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
    },
});

/**
 * Enqueues a Nuclei scan to run on the background worker (restart-safe,
 * retries once on failure). Same pattern as the DAST/ZAP queue.
 */
export const enqueueNucleiScan = (payload: NucleiWorkerPayload) => {
    return nucleiQueue.add('nuclei', payload, { jobId: `nuclei-${payload.scanId}` });
};
