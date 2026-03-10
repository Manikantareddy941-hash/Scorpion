import cron from 'node-cron';
import { checkOverdueTasks } from '../services/notificationService';
import { scanRepositories } from './github-scanner';

export const initScheduler = () => {
    console.log('[Scheduler] Initializing cron jobs...');

    // Check for overdue tasks every hour
    cron.schedule('0 * * * *', async () => {
        console.log('[Scheduler] Running overdue task check...');
        try {
            await checkOverdueTasks();
        } catch (error) {
            console.error('[Scheduler] Error checking overdue tasks:', error);
        }
    });

    // Run repository scans every 6 hours
    cron.schedule('0 */6 * * *', async () => {
        console.log('[Scheduler] Running repository scans...');
        try {
            await scanRepositories();
        } catch (error) {
            console.error('[Scheduler] Error scanning repositories:', error);
        }
    });
};
