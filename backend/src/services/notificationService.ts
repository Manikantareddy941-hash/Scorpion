import { enqueueNotification } from './notificationQueue';
import { formatSlackScanResult } from './webhookService';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export const dispatchNotification = async (repoId: string, eventType: string, metadata: any) => {
    try {
        // 1. Get repo info
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
        if (!repo) return;

        const userId = repo.user_id;

        // 2. Fetch notification preferences
        // Find enabled preferences for this event type that are either repository-specific or global (repo_id is null)
        const prefsResponse = await databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATION_PREFERENCES, [
            Query.equal('user_id', userId),
            Query.equal('event_type', eventType),
            Query.equal('enabled', true),
            Query.or([
                Query.equal('repo_id', repoId),
                Query.equal('repo_id', 'global'), // Or Query.isNull('repo_id') if supported/used
            ])
        ]);

        const prefs = prefsResponse.documents;

        if (prefs.length === 0) {
            // Default behavior if no preferences set?
            if (eventType === 'scan_completed') {
                // assume default logic here if needed
            }
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
        if (!scan) return;

        const details = typeof scan.details === 'string' ? JSON.parse(scan.details) : scan.details;
        const score = details?.security_score || 0;
        const vulns = details?.total_vulnerabilities || 0;

        await dispatchNotification(scan.repo_id, 'scan_completed', { score, vulns });

        // Additional event if critical
        if (details?.critical_count > 0) {
            await dispatchNotification(scan.repo_id, 'critical_detected', { score, vulns, critical: details.critical_count });
        }
    } catch (err) {
        console.error('[NotificationService] Error in notifyScanCompletion:', err);
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
