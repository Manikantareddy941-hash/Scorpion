import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { NUCLEI_QUEUE_NAME } from './nucleiQueue';
import { runNucleiScan, NucleiWorkerPayload } from '../workers/nucleiWorker';
import { logger } from '../services/logger';

let nucleiWorker: Worker<NucleiWorkerPayload> | null = null;

export const initNucleiQueueWorker = () => {
    nucleiWorker = new Worker<NucleiWorkerPayload>(
        NUCLEI_QUEUE_NAME,
        async (job) => {
            await runNucleiScan(job.data);
        },
        {
            connection: redisConnection,
            concurrency: 2,
        }
    );

    nucleiWorker.on('failed', (job, err) => {
        logger.error(`[NucleiQueue] Job ${job?.id} failed:`, err.message);
    });

    logger.info('[NucleiQueue] Worker initialized.');
    return nucleiWorker;
};

export const isNucleiQueueWorkerRunning = () => !!nucleiWorker;
