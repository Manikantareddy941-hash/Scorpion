import cron from 'node-cron';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { reportQueue } from '../queues/reportQueue';
import { generateSecuritySummary } from './aiService';
import { sendAiReportEmail } from './emailService';
import { logger, errorContext } from './logger';
import { marked } from 'marked';

/**
 * Scheduled AI reports via BullMQ job schedulers (Redis-backed) — with N
 * backend replicas a schedule fires exactly once. The minute-tick reconciles
 * DB config into schedulers idempotently; the report itself executes on the
 * report queue worker (reportQueueWorker.ts).
 */

const SCHEDULER_PREFIX = 'report-';
const AI_SUMMARY_TIMEOUT_MS = 15000;

const getRangeBoundary = (range: string) => {
    const now = new Date();
    switch (range) {
        case '15m': return new Date(now.getTime() - 15 * 60000).toISOString();
        case '1h': return new Date(now.getTime() - 60 * 60000).toISOString();
        case '24h': return new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
        case '7d': return new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
        default: return new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    }
};

/**
 * Executes one scheduled AI report. Re-reads the schedule document so config
 * changes (emails, range, deactivation) between the scheduler firing and the
 * worker picking the job up are honored.
 */
export const runScheduledReport = async (scheduleId: string): Promise<void> => {
    const schedule = await databases.getDocument(DB_ID, COLLECTIONS.REPORTS_SCHEDULE, scheduleId);
    if (!schedule.is_active) {
        logger.info(`[ReportScheduler] Schedule ${scheduleId} deactivated, skipping.`);
        return;
    }

    const targetEmails: string[] = schedule.emails || [];
    const range: string = schedule.range || '7d';
    const boundary = getRangeBoundary(range);

    const findings = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.greaterThanEqual('$createdAt', boundary),
        Query.limit(100)
    ]);
    const alerts = await databases.listDocuments(DB_ID, COLLECTIONS.INCIDENTS, [
        Query.greaterThanEqual('$createdAt', boundary),
        Query.limit(50)
    ]);

    const summaryPromise = generateSecuritySummary(findings.documents, alerts.documents);
    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), AI_SUMMARY_TIMEOUT_MS)
    );
    const markdownSummary = (await Promise.race([summaryPromise, timeoutPromise])) as string;
    const htmlSummary = await marked.parse(markdownSummary);

    for (const email of targetEmails) {
        await sendAiReportEmail(email, htmlSummary, range);
        logger.info(`[ReportScheduler] Scheduled AI Report dispatched successfully to user ${email}`);
    }
};

export const reconcileReportSchedules = async (): Promise<void> => {
    const response = await databases.listDocuments(DB_ID, COLLECTIONS.REPORTS_SCHEDULE, [
        Query.equal('is_active', true),
        Query.limit(100)
    ]);

    const active = new Map<string, string>(
        response.documents.map(doc => [doc.$id, doc.cron_schedule || '0 8 * * 1'])
    );

    const existing = await reportQueue.getJobSchedulers();
    for (const scheduler of existing) {
        const id = scheduler.key;
        if (!id || !id.startsWith(SCHEDULER_PREFIX)) continue;
        if (!active.has(id.slice(SCHEDULER_PREFIX.length))) {
            logger.info(`[ReportScheduler] Removing report schedule ${id}`);
            await reportQueue.removeJobScheduler(id);
        }
    }

    for (const [scheduleId, cronExpr] of active) {
        if (!cron.validate(cronExpr)) {
            logger.error(`[ReportScheduler] Invalid cron schedule for ${scheduleId}: ${cronExpr}`);
            continue;
        }
        await reportQueue.upsertJobScheduler(
            `${SCHEDULER_PREFIX}${scheduleId}`,
            { pattern: cronExpr },
            { name: 'ai-report', data: { scheduleId } }
        );
    }
};

export const initReportScheduler = () => {
    logger.info('[ReportScheduler] Initializing report schedule reconciler...');
    cron.schedule('* * * * *', () => {
        reconcileReportSchedules().catch(error =>
            // Log safely, the collection might not exist during setup
            logger.error('[ReportScheduler] Error reconciling report schedules (ensure collection exists):', {
                event: 'SCHEDULER_REPORT_RECONCILE_FAILED', ...errorContext(error),
            })
        );
    });
};
