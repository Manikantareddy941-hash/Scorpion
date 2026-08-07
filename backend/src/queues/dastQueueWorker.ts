import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { DAST_QUEUE_NAME } from './dastQueue';
import { runZapScan, ZapWorkerPayload } from '../workers/zapWorker';
import { logger, errorContext } from '../services/logger';

let dastWorker: Worker<ZapWorkerPayload> | null = null;

export const initDastQueueWorker = () => {
    dastWorker = new Worker<ZapWorkerPayload>(
        DAST_QUEUE_NAME,
        async (job) => {
            await runZapScan(job.data);
        },
        {
            connection: redisConnection,
            // ponytail: single concurrency — one ZAP instance can't run two
            // scans at once. Raise only with a ZAP-per-worker pool.
            concurrency: 1,
        }
    );

    dastWorker.on('failed', (job, err) => {
        logger.error('[DastQueue] job failed', {
            event: 'WORKER_JOB_FAILED',
            queue: DAST_QUEUE_NAME,
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            ...errorContext(err),
        });
    });

    logger.info('[DastQueue] Worker initialized.');
    return dastWorker;
};

export const isDastQueueWorkerRunning = () => !!dastWorker;
