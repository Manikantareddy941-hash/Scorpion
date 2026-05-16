import cron from 'node-cron';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { generateSecuritySummary } from './aiService';
import { sendAiReportEmail } from './emailService';
import { logger } from './logger';
import { marked } from 'marked';

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

const activeReportJobs = new Map<string, cron.ScheduledTask>();

export const initReportScheduler = () => {
    logger.info('[ReportScheduler] Initializing AI report scheduler...');

    // Sync schedules every minute
    cron.schedule('* * * * *', async () => {
        try {
            const response = await databases.listDocuments(DB_ID, COLLECTIONS.REPORTS_SCHEDULE, [
                Query.equal('is_active', true),
                Query.limit(100)
            ]);

            const currentActiveScheduleIds = new Set(response.documents.map(doc => doc.$id));

            // Remove inactive jobs
            for (const [scheduleId, job] of activeReportJobs.entries()) {
                if (!currentActiveScheduleIds.has(scheduleId)) {
                    logger.info(`[ReportScheduler] Stopping job for schedule: ${scheduleId}`);
                    job.stop();
                    activeReportJobs.delete(scheduleId);
                }
            }

            // Add or update jobs
            for (const schedule of response.documents) {
                const scheduleId = schedule.$id;
                const cronExpr = schedule.cron_schedule || '0 8 * * 1'; // Default: Monday 8 AM
                const targetEmails: string[] = schedule.emails || [];
                const range = schedule.range || '7d';

                const jobKey = `${scheduleId}_${cronExpr}`;
                
                let existingJobFound = false;
                for (const key of activeReportJobs.keys()) {
                    if (key.startsWith(scheduleId + '_')) {
                        if (key === jobKey) {
                            existingJobFound = true;
                        } else {
                            logger.info(`[ReportScheduler] Schedule changed for ${scheduleId}, replacing old job.`);
                            activeReportJobs.get(key)?.stop();
                            activeReportJobs.delete(key);
                        }
                    }
                }

                if (!existingJobFound) {
                    if (cron.validate(cronExpr)) {
                        logger.info(`[ReportScheduler] Scheduling AI Report: ${scheduleId} with cron: ${cronExpr}`);
                        const task = cron.schedule(cronExpr, async () => {
                            logger.info(`[ReportScheduler] Executing AI Report for schedule: ${scheduleId}`);
                            try {
                                const boundary = getRangeBoundary(range);
                                
                                // Gather data
                                const findings = await databases.listDocuments(DB_ID, 'findings', [
                                    Query.greaterThanEqual('$createdAt', boundary),
                                    Query.limit(100)
                                ]);
                                
                                const alerts = await databases.listDocuments(DB_ID, 'alerts', [
                                    Query.greaterThanEqual('$createdAt', boundary),
                                    Query.limit(50)
                                ]);

                                // Generate summary via AI service
                                const summaryPromise = generateSecuritySummary(findings.documents, alerts.documents);
                                const timeoutPromise = new Promise((_, reject) => 
                                    setTimeout(() => reject(new Error('TIMEOUT')), 15000)
                                );
                                
                                const markdownSummary = await Promise.race([summaryPromise, timeoutPromise]) as string;
                                
                                // Convert to HTML
                                const htmlSummary = await marked.parse(markdownSummary);

                                // Dispatch emails
                                for (const email of targetEmails) {
                                    await sendAiReportEmail(email, htmlSummary, range);
                                    logger.info(`[ReportScheduler] Scheduled AI Report dispatched successfully to user ${email}`);
                                }

                            } catch (error: any) {
                                logger.error(`[ReportScheduler] Error generating report for schedule ${scheduleId}:`, error);
                            }
                        });
                        activeReportJobs.set(jobKey, task);
                    } else {
                        logger.error(`[ReportScheduler] Invalid cron schedule for ${scheduleId}: ${cronExpr}`);
                    }
                }
            }

        } catch (error) {
            // Log safely, the collection might not exist during setup
            logger.error('[ReportScheduler] Error syncing report schedules from database (ensure collection exists).', error);
        }
    });
};
