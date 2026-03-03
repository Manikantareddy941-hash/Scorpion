import { Worker, Job } from 'bullmq';
import { connection, SCAN_QUEUE_NAME } from './queue';
import { runScan } from './scanner';
import pool, { query } from './db';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Environment Validation
const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    LOG_LEVEL: z.enum(['info', 'debug', 'error']).default('info'),
});

try {
    const env = envSchema.parse(process.env);
    console.log(`Worker starting with Log Level: ${env.LOG_LEVEL}`);

    const worker = new Worker(
        SCAN_QUEUE_NAME,
        async (job: Job) => {
            const { scanId } = job.data;
            console.log(`Processing Job ${job.id} for scan ${scanId}`);

            try {
                // Fetch repo_url from database
                const result = await query(
                    'SELECT repo_url FROM scans WHERE id = $1',
                    [scanId]
                );

                if (result.rows.length === 0) {
                    throw new Error(`Scan ${scanId} not found in database`);
                }

                const repoUrl = result.rows[0].repo_url;

                if (!repoUrl) {
                    throw new Error(`Scan ${scanId} has no repo_url`);
                }

                await runScan(scanId, repoUrl);
            } catch (error: any) {
                console.error(`Job ${job.id} failed:`, error.message);
                throw error; // Let BullMQ handle retry
            }
        },
        {
            connection: connection as any,
            concurrency: 2 // Handle 2 scans at once
        }
    );

    worker.on('completed', (job) => {
        console.log(`Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
        console.error(`Job ${job?.id} failed with error: ${err.message}`);
    });

} catch (error: any) {
    console.error('Failed to start worker due to config error:', error.message);
    process.exit(1);
}
