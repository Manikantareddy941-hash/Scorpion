import { sendScanCompletionEmail, sendCriticalAlertEmail } from './emailService';
import { sendSlackWebhook, sendDiscordWebhook } from './webhookService';
import { databases, DB_ID, COLLECTIONS, ID, users } from '../lib/appwrite';

export const enqueueNotification = async (payload: {
    user_id: string;
    repo_id: string;
    event_type: string;
    channel: string;
    data: any;
}) => {
    try {
        const notification = await databases.createDocument(DB_ID, COLLECTIONS.NOTIFICATIONS, ID.unique(), {
            user_id: payload.user_id,
            repo_id: payload.repo_id,
            event_type: payload.event_type,
            channel: payload.channel,
            payload: JSON.stringify(payload.data),
            status: 'pending',
            created_at: new Date().toISOString()
        });

        // Process immediately in background
        processNotification(notification.$id);
    } catch (err) {
        console.error('[NotificationQueue] Failed to enqueue:', err);
    }
};

export const processNotification = async (id: string) => {
    try {
        const notification = await databases.getDocument(DB_ID, COLLECTIONS.NOTIFICATIONS, id);
        if (!notification) return;

        const payload = typeof notification.payload === 'string' ? JSON.parse(notification.payload) : notification.payload;
        let success = false;
        let errorMsg = '';

        try {
            if (notification.channel === 'email') {
                const user = await users.get(notification.user_id);
                if (user?.email) {
                    if (notification.event_type === 'critical_detected') {
                        await sendCriticalAlertEmail(user.email, 'Repository', payload.vulns, payload.score);
                    } else {
                        await sendScanCompletionEmail(user.email, 'Repository', payload.score);
                    }
                    success = true;
                }
            } else if (notification.channel === 'slack') {
                const res = await sendSlackWebhook(payload.webhook_url, payload.message);
                success = res.success;
                errorMsg = res.error || '';
            } else if (notification.channel === 'discord') {
                const res = await sendDiscordWebhook(payload.webhook_url, payload.message);
                success = res.success;
                errorMsg = res.error || '';
            }

            if (success) {
                await databases.updateDocument(DB_ID, COLLECTIONS.NOTIFICATIONS, id, {
                    status: 'sent',
                    sent_at: new Date().toISOString()
                });
            } else {
                throw new Error(errorMsg || 'Failed to send');
            }
        } catch (err: any) {
            const retryCount = (notification.retry_count || 0) + 1;
            const status = retryCount > 3 ? 'failed' : 'pending';

            await databases.updateDocument(DB_ID, COLLECTIONS.NOTIFICATIONS, id, {
                status,
                retry_count: retryCount,
                last_error: err.message
            });

            if (status === 'pending') {
                // Retry after delay
                setTimeout(() => processNotification(id), 5000 * Math.pow(2, retryCount));
            }
        }
    } catch (err) {
        console.error(`[NotificationQueue] Error processing notification ${id}:`, err);
    }
};
