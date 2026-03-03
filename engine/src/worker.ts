import { Worker, Job } from 'bullmq';
import { connection, SCAN_QUEUE_NAME } from './queue';
import { runScan } from './scanner';
import pool, { query, getClient } from './db';
import dotenv from 'dotenv';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
dotenv.config();

const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    LOG_LEVEL: z.enum(['info', 'debug', 'error']).default('info'),
});

const TEMP_BASE_DIR = process.env.TEMP_DIR || '/tmp';

async function startupSweep() {
    console.log('[Worker] Running startup container sweep (killing orphans > 30m)...');
    try {
        // Clean containers older than 30 mins
        await execAsync('docker ps -a --filter "name=scanner-" --format "{{.ID}} {{.CreatedAt}}" | while read id date time zone; do if [ $(date -d "$date $time" +%s) -lt $(date -d "30 minutes ago" +%s) ]; then docker rm -f $id; fi; done').catch(() => { });
    } catch (e) { /* Ignore */ }
}

async function startZombieSweeper() {
    console.log('[Worker] Starting Background Zombie Sweeper (20m rule)...');
    setInterval(async () => {
        try {
            const result = await query(
                `UPDATE scans 
                 SET status = 'failed', 
                     error_message = 'Scan abandoned (stuck in scanning > 20m)', 
                     completed_at = NOW() 
                 WHERE status = 'scanning' AND updated_at < NOW() - INTERVAL '20 minutes' 
                 RETURNING id`
            );

            for (const row of result.rows) {
                console.warn(`[ZombieSweeper] Recovered abandoned scan ${row.id}`);
                await execAsync(`docker rm -f scanner-*-${row.id} || true`);
                const repoPath = path.join(TEMP_BASE_DIR, row.id);
                if (fs.existsSync(repoPath)) {
                    await fs.promises.rm(repoPath, { recursive: true, force: true }).catch(() => { });
                }
            }
        } catch (e: any) {
            console.error('[ZombieSweeper] Error:', e.message);
        }
    }, 60000); // Run every minute
}

try {
    const env = envSchema.parse(process.env);
    console.log(`Worker starting with Log Level: ${env.LOG_LEVEL}`);

    // Init Sweepers
    startupSweep();
    startZombieSweeper();

    const worker = new Worker(
        SCAN_QUEUE_NAME,
        async (job: Job) => {
            const { scanId } = job.data;
            const repoPath = path.join(TEMP_BASE_DIR, scanId);

            console.log(`Processing Job ${job.id} for scan ${scanId}`);

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Job exceeded hard timeout limit (10m)')), 600000);
            });

            try {
                await Promise.race([
                    (async () => {
                        const result = await query('SELECT repo_url, status FROM scans WHERE id = $1', [scanId]);
                        if (result.rows.length === 0) throw new Error(`Scan ${scanId} not found`);

                        const { repo_url, status } = result.rows[0];
                        if (status === 'completed') return; // Idempotency check

                        await runScan(scanId, repo_url);
                    })(),
                    timeoutPromise
                ]);
            } catch (error: any) {
                console.error(`Job ${job.id} failed:`, error.message);
                // Explicitly kill scan containers on timeout
                await execAsync(`docker rm -f scanner-*-${scanId} || true`).catch(() => { });
                throw error;
            } finally {
                if (fs.existsSync(repoPath)) {
                    await fs.promises.rm(repoPath, { recursive: true, force: true }).catch(() => { });
                }
            }
        },
        {
            connection: connection as any,
            concurrency: 2
        }
    );

    worker.on('failed', (job, err) => {
        console.error(`Job ${job?.id} failed: ${err.message}`);
    });

} catch (error: any) {
    console.error('Failed to start worker:', error.message);
    process.exit(1);
}
