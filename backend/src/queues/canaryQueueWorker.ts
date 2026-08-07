import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { CANARY_QUEUE_NAME } from './canaryQueue';
import { runCanaryTick, CanaryWorkerPayload } from '../gitops/canaryService';
import { logger, errorContext } from '../services/logger';

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
        logger.error('[CanaryQueue] job failed', {
            event: 'WORKER_JOB_FAILED',
            queue: CANARY_QUEUE_NAME,
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            ...errorContext(err),
        });
    });

    logger.info('[CanaryQueue] Worker initialized.');
    return canaryWorker;
};

export const isCanaryQueueWorkerRunning = () => !!canaryWorker;
