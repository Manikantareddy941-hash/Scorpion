import cron from 'node-cron';
import { databases, DB_ID, COLLECTIONS, Query } from './lib/appwrite';
import { scanQueue } from './queues/scanQueue';
import { auditQueue } from './queues/auditQueue';
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

/**
 * Audit ledger verification, on a fixed schedule rather than reconciled from the
 * database: these are not per-repo, and there is no configuration that could turn
 * them off. A control the operator can disable through the UI is one that will be
 * found disabled after the incident.
 *
 * Both use a fixed scheduler id, so every replica upserting the same schedule
 * converges on one entry instead of N. Combined with `concurrency: 1` on the
 * worker, that means one verification runs at a time regardless of how the
 * deployment is scaled.
 */
const AUDIT_TAIL_SCHEDULER_ID = 'audit-verify-tail';
const AUDIT_FULL_SCHEDULER_ID = 'audit-verify-full';

export const reconcileAuditSchedules = async (): Promise<void> => {
    await auditQueue.upsertJobScheduler(
        AUDIT_TAIL_SCHEDULER_ID,
        { pattern: '*/15 * * * *' },
        { name: 'verify', data: { tier: 'tail' } },
    );

    // 02:00 — off-peak for the O(N) walk, which is the one pass whose cost grows
    // with the ledger.
    await auditQueue.upsertJobScheduler(
        AUDIT_FULL_SCHEDULER_ID,
        { pattern: '0 2 * * *' },
        { name: 'verify', data: { tier: 'full' } },
    );
};

export const initScheduler = () => {
    logger.info('[Scheduler] Initializing scan schedule reconciler...');
    cron.schedule('* * * * *', () => {
        reconcileScanSchedules().catch(error =>
            logger.error('[Scheduler] Error reconciling scan schedules:', error)
        );
    });

    // Registered once at boot, not on the minute tick: the patterns are constant,
    // so re-upserting them every 60 seconds would be churn with no effect.
    reconcileAuditSchedules()
        .then(() => logger.info('[Scheduler] Audit verification scheduled (tail */15m, full daily 02:00)'))
        .catch(error =>
            // Loud, because the failure mode is silent: no schedule means no
            // verification, and nothing else would ever mention it again.
            logger.error('[Scheduler] FAILED to schedule audit verification — the ledger will NOT be checked:', error)
        );
};
