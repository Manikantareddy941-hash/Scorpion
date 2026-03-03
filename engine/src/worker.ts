import { Worker, Job } from 'bullmq';
import { connection, SCAN_QUEUE_NAME } from './queue';
import { runScan } from './scanner';
import dotenv from 'dotenv';

dotenv.config();

console.log('Worker starting...');

const worker = new Worker(
    SCAN_QUEUE_NAME,
    async (job: Job) => {
        const { scanId, repoUrl } = job.data;
        console.log(`Processing Job ${job.id} for scan ${scanId}`);
        try {
            await runScan(scanId, repoUrl);
        } catch (error: any) {
            console.error(`Job ${job.id} failed:`, error.message);
            throw error; // Let BullMQ handle retry
        }
    },
    {
        connection,
        concurrency: 2 // Handle 2 scans at once
    }
);

worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed with error: ${err.message}`);
});
