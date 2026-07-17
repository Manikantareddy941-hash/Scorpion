import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { REPORT_QUEUE_NAME, ReportJobData } from './reportQueue';
import { runScheduledReport } from '../services/scheduleService';
import { logger } from '../services/logger';

let queueWorker: Worker<ReportJobData> | null = null;

export const initReportQueueWorker = () => {
    queueWorker = new Worker<ReportJobData>(
        REPORT_QUEUE_NAME,
        async (job) => {
            await runScheduledReport(job.data.scheduleId);
        },
        {
            connection: redisConnection,
            concurrency: 1,
        }
    );

    queueWorker.on('failed', (job, err) => {
        logger.error(`[ReportQueue] Job ${job?.id} failed:`, err.message);
    });

    logger.info('[ReportQueue] Worker initialized.');
    return queueWorker;
};
