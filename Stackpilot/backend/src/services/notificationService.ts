import { databases, COLLECTIONS, DB_ID, Query } from '../lib/appwrite';
import { enqueueNotification } from './notificationQueue';
import { formatSlackScanResult } from './webhookService';

export const dispatchNotification = async (repoId: string, eventType: string, metadata: any) => {
    try {
        // 1. Get repo and user info
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
        const userId = repo.user_id;

        // 2. Fetch notification preferences
        // Since Appwrite's Query.or is limited, we fetch preferences for the user and filter in code
        const response = await databases.listDocuments(
            DB_ID,
            'notification_preferences',
            [Query.equal('user_id', userId), Query.equal('event_type', eventType), Query.equal('enabled', true)]
        );

        const prefs = response.documents.filter((p: any) => !p.repo_id || p.repo_id === repoId);

        if (prefs.length === 0) {
            return;
        }

        // 3. Enqueue for each enabled channel
        for (const pref of prefs) {
            let payload = {};

            if (pref.channel === 'slack' || pref.channel === 'discord') {
                payload = {
                    webhook_url: pref.target_value,
                    message: formatSlackScanResult(repo.name, metadata.score, metadata.vulns, `${process.env.FRONTEND_URL}/project/${repoId}`)
                };
            } else if (pref.channel === 'email') {
                // payload for email
            }

            await enqueueNotification({
                user_id: userId,
                repo_id: repoId,
                event_type: eventType,
                channel: pref.channel,
                data: payload
            });
        }
    } catch (err) {
        console.error('[NotificationService] Error dispatching notification:', err);
    }
};

export const notifyScanCompletion = async (scanId: string) => {
    try {
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        const details = typeof scan.details === 'string' ? JSON.parse(scan.details) : (scan.details || {});

        const score = details.security_score || 0;
        const vulns = details.total_vulnerabilities || 0;

        await dispatchNotification(scan.repo_id, 'scan_completed', { score, vulns });

        // Additional event if critical
        if (details.critical_count > 0) {
            await dispatchNotification(scan.repo_id, 'critical_detected', { score, vulns, critical: details.critical_count });
        }
    } catch (err) {
        console.error('[NotificationService] Error notifying scan completion:', err);
    }
};

export const notifyPolicyFailure = async (repoId: string, scanId: string, result: string, reason: string) => {
    if (result === 'FAIL') {
        await dispatchNotification(repoId, 'policy_failure', { scanId, reason });
    }
};

export const checkOverdueTasks = async () => {
    console.log('[NotificationService] Checking for overdue tasks...');
};
