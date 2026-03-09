import { databases, users, DB_ID, ID } from '../lib/appwrite';
import { sendScanCompletionEmail, sendCriticalAlertEmail } from './emailService';
import { sendSlackWebhook, sendDiscordWebhook } from './webhookService';

export const enqueueNotification = async (payload: any) => {
    try {
        const data = await databases.createDocument(
            DB_ID,
            'notifications',
            ID.unique(),
            {
                user_id: payload.user_id,
                repo_id: payload.repo_id,
                event_type: payload.event_type,
                channel: payload.channel,
                payload: JSON.stringify(payload.data),
                status: 'pending',
                created_at: new Date().toISOString()
            }
        );

        // Process immediately in background
        processNotification(data.$id);
    } catch (error) {
        console.error('[NotificationQueue] Failed to enqueue:', error);
    }
};

export const processNotification = async (id: string) => {
    try {
        const notification = await databases.getDocument(DB_ID, 'notifications', id);
        const payload = typeof notification.payload === 'string' ? JSON.parse(notification.payload) : (notification.payload || {});

        let success = false;
        let errorMsg = '';

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
            await databases.updateDocument(DB_ID, 'notifications', id, {
                status: 'sent',
                sent_at: new Date().toISOString()
            });
        } else {
            throw new Error(errorMsg || 'Failed to send');
        }
    } catch (err: any) {
        try {
            const notification = await databases.getDocument(DB_ID, 'notifications', id);
            const retryCount = (notification.retry_count || 0) + 1;
            const status = retryCount > 3 ? 'failed' : 'pending';

            await databases.updateDocument(DB_ID, 'notifications', id, {
                status,
                retry_count: retryCount,
                last_error: err.message
            });

            if (status === 'pending') {
                // Retry after delay
                setTimeout(() => processNotification(id), 5000 * Math.pow(2, retryCount));
            }
        } catch (innerErr) {
            console.error('[NotificationQueue] Fatal error during retry logic:', innerErr);
        }
    }
};
