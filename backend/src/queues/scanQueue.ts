import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

export interface ScanJobData {
    repoId: string;
    options?: { scanType?: any; scanDepth?: any; branch?: string };
    scanId?: string;
}

export const SCAN_QUEUE_NAME = 'scan-execution';

export const scanQueue = new Queue<ScanJobData>(SCAN_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
    },
});

/**
 * Enqueues a scan to run on the background worker instead of inline in the
 * calling request/cron tick. Jobs survive process restarts and retry once
 * on failure (Redis-backed via BullMQ).
 */
export const enqueueScan = async (
    repoId: string,
    options: ScanJobData['options'] = {},
    scanId?: string
) => {
    const jobId = scanId ? `scan-${scanId}` : `repo-${repoId}-${Date.now()}`;
    return scanQueue.add('scan', { repoId, options, scanId }, { jobId });
};
