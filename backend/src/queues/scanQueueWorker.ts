import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { SCAN_QUEUE_NAME, ScanJobData } from './scanQueue';
import { triggerScan } from '../services/scanService';
import { logger } from '../services/logger';

let queueWorker: Worker<ScanJobData> | null = null;

export const initScanQueueWorker = () => {
    queueWorker = new Worker<ScanJobData>(
        SCAN_QUEUE_NAME,
        async (job) => {
            const { repoId, options, scanId } = job.data;
            const { error } = await triggerScan(repoId, options || {}, scanId);
            if (error) throw new Error(error);
        },
        {
            connection: redisConnection,
            concurrency: 2,
        }
    );

    queueWorker.on('failed', (job, err) => {
        logger.error(`[ScanQueue] Job ${job?.id} failed:`, err.message);
    });

    logger.info('[ScanQueue] Worker initialized.');
    return queueWorker;
};

export const isScanQueueWorkerRunning = () => !!queueWorker;
