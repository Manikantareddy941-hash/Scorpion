import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { FFUF_QUEUE_NAME } from './ffufQueue';
import { runFfufScan, FfufWorkerPayload } from '../workers/ffufWorker';
import { logger } from '../services/logger';

let ffufWorker: Worker<FfufWorkerPayload> | null = null;

export const initFfufQueueWorker = () => {
    ffufWorker = new Worker<FfufWorkerPayload>(
        FFUF_QUEUE_NAME,
        async (job) => {
            await runFfufScan(job.data);
        },
        {
            connection: redisConnection,
            concurrency: 2,
        }
    );

    ffufWorker.on('failed', (job, err) => {
        logger.error(`[FfufQueue] Job ${job?.id} failed:`, err.message);
    });

    logger.info('[FfufQueue] Worker initialized.');
    return ffufWorker;
};

export const isFfufQueueWorkerRunning = () => !!ffufWorker;
