import cron from 'node-cron';
import { databases, DB_ID, COLLECTIONS, Query } from './lib/appwrite';
import { triggerScan } from './services/scanService';

// Map to keep track of active cron jobs by repo ID
const activeJobs = new Map<string, cron.ScheduledTask>();

export const initScheduler = () => {
    console.log('[Scheduler] Initializing dynamic scan scheduler...');

    // Run a manager task every minute to sync cron jobs from the database
    cron.schedule('* * * * *', async () => {
        try {
            // Fetch all repositories that have cron_enabled = true
            const response = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
                Query.equal('cron_enabled', true),
                Query.limit(100) // Handle pagination if necessary for large numbers of repos
            ]);

            const currentActiveRepoIds = new Set(response.documents.map(repo => repo.$id));

            // Stop and remove jobs for repos that are no longer active
            for (const [repoId, job] of activeJobs.entries()) {
                if (!currentActiveRepoIds.has(repoId)) {
                    console.log(`[Scheduler] Stopping and removing cron job for repo: ${repoId}`);
                    job.stop();
                    activeJobs.delete(repoId);
                }
            }

            // Add or update jobs for active repos
            for (const repo of response.documents) {
                const repoId = repo.$id;
                const schedule = repo.cron_schedule || '0 0 * * *'; // Default to daily at midnight if missing
                
                // If a job already exists, we might want to check if the schedule changed.
                // For simplicity, if it exists, we assume it's running the correct schedule. 
                // To be robust against schedule updates, we could store the schedule string in the map 
                // but since node-cron doesn't expose the cron expression easily from the task,
                // we'll manage a complex object if needed. For now, we'll recreate if we need to track schedule changes.
                // Actually, let's just use the repoId + schedule as the key to detect changes.
                const jobKey = `${repoId}_${schedule}`;
                
                let existingJobFound = false;
                for (const key of activeJobs.keys()) {
                    if (key.startsWith(repoId + '_')) {
                        if (key === jobKey) {
                            existingJobFound = true;
                        } else {
                            // Schedule changed, stop the old one
                            console.log(`[Scheduler] Schedule changed for repo: ${repoId}, stopping old job`);
                            activeJobs.get(key)?.stop();
                            activeJobs.delete(key);
                        }
                    }
                }

                if (!existingJobFound) {
                    if (cron.validate(schedule)) {
                        console.log(`[Scheduler] Scheduling scan for repo: ${repoId} with cron: ${schedule}`);
                        const task = cron.schedule(schedule, async () => {
                            console.log(`[Scheduler] Executing scheduled scan for repo: ${repoId}`);
                            try {
                                // Calls internal scan service directly which is equivalent to POST /api/scan
                                await triggerScan(repoId, repo.visibility || 'public');
                                console.log(`[Scheduler] Scan triggered successfully for repo: ${repoId}`);
                            } catch (error) {
                                console.error(`[Scheduler] Error triggering scan for repo ${repoId}:`, error);
                            }
                        });
                        activeJobs.set(jobKey, task);
                    } else {
                        console.error(`[Scheduler] Invalid cron schedule for repo ${repoId}: ${schedule}`);
                    }
                }
            }

        } catch (error) {
            console.error('[Scheduler] Error syncing cron jobs from database:', error);
        }
    });
};
