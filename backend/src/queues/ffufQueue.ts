import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';
import type { FfufWorkerPayload } from '../workers/ffufWorker';

export const FFUF_QUEUE_NAME = 'ffuf-execution';

export const ffufQueue = new Queue<FfufWorkerPayload>(FFUF_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
    },
});

/**
 * Enqueues an ffuf content-discovery fuzz on the background worker
 * (restart-safe, retries once). Same pattern as the DAST/Nuclei queues.
 */
export const enqueueFfufScan = (payload: FfufWorkerPayload) => {
    return ffufQueue.add('ffuf', payload, { jobId: `ffuf-${payload.scanId}` });
};
