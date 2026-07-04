import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { CANARY_QUEUE_NAME } from './canaryQueue';
import { runCanaryTick, CanaryWorkerPayload } from '../gitops/canaryService';
import { logger } from '../services/logger';

let canaryWorker: Worker<CanaryWorkerPayload> | null = null;

export const initCanaryQueueWorker = () => {
    canaryWorker = new Worker<CanaryWorkerPayload>(
        CANARY_QUEUE_NAME,
        async (job) => {
            await runCanaryTick(job.data.canaryId, job.data.tick);
        },
        {
            connection: redisConnection,
            // Ticks are short metric queries, not scanner runs — safe to overlap.
            concurrency: 4,
        }
    );

    canaryWorker.on('failed', (job, err) => {
        logger.error(`[CanaryQueue] Job ${job?.id} failed:`, err.message);
    });

    logger.info('[CanaryQueue] Worker initialized.');
    return canaryWorker;
};

export const isCanaryQueueWorkerRunning = () => !!canaryWorker;
