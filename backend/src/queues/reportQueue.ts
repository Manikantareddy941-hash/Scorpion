import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

export interface ReportJobData {
    scheduleId: string;
}

export const REPORT_QUEUE_NAME = 'report-dispatch';

export const reportQueue = new Queue<ReportJobData>(REPORT_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
    },
});
