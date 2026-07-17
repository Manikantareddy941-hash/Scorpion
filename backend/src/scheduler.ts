import cron from 'node-cron';
import { databases, DB_ID, COLLECTIONS, Query } from './lib/appwrite';
import { scanQueue } from './queues/scanQueue';
import { logger } from './services/logger';

/**
 * Scheduled repo scans via BullMQ job schedulers (Redis-backed) instead of
 * per-process node-cron tasks: with N backend replicas a schedule fires
 * exactly once, not N times. The minute-tick here only *reconciles* DB config
 * into schedulers — upserts and removals are idempotent, so every replica can
 * safely run the reconcile loop.
 */

const SCHEDULER_PREFIX = 'repo-scan-';

export const reconcileScanSchedules = async (): Promise<void> => {
    const response = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
        Query.equal('cron_enabled', true),
        Query.limit(100)
    ]);

    const active = new Map<string, string>(
        response.documents.map(repo => [repo.$id, repo.cron_schedule || '0 0 * * *'])
    );

    // Drop schedulers whose repo disabled cron (or was deleted)
    const existing = await scanQueue.getJobSchedulers();
    for (const scheduler of existing) {
        const id = scheduler.key;
        if (!id || !id.startsWith(SCHEDULER_PREFIX)) continue;
        if (!active.has(id.slice(SCHEDULER_PREFIX.length))) {
            logger.info(`[Scheduler] Removing scan schedule ${id}`);
            await scanQueue.removeJobScheduler(id);
        }
    }

    // Upsert the rest — same id + new pattern updates in place
    for (const [repoId, schedule] of active) {
        if (!cron.validate(schedule)) {
            logger.error(`[Scheduler] Invalid cron schedule for repo ${repoId}: ${schedule}`);
            continue;
        }
        await scanQueue.upsertJobScheduler(
            `${SCHEDULER_PREFIX}${repoId}`,
            { pattern: schedule },
            { name: 'scan', data: { repoId, options: {} } }
        );
    }
};

export const initScheduler = () => {
    logger.info('[Scheduler] Initializing scan schedule reconciler...');
    cron.schedule('* * * * *', () => {
        reconcileScanSchedules().catch(error =>
            logger.error('[Scheduler] Error reconciling scan schedules:', error)
        );
    });
};
