import { createClient } from '@supabase/supabase-js';
import { sendScanCompletionEmail, sendCriticalAlertEmail } from './emailService';
import { sendSlackWebhook, sendDiscordWebhook } from './webhookService';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    return createClient(supabaseUrl, supabaseKey);
};

export const enqueueNotification = async (payload: any) => {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('notifications')
        .insert({
            user_id: payload.user_id,
            repo_id: payload.repo_id,
            event_type: payload.event_type,
            channel: payload.channel,
            payload: payload.data,
            status: 'pending'
        })
        .select()
        .single();

    if (error) {
        console.error('[NotificationQueue] Failed to enqueue:', error);
        return;
    }

    // Process immediately in background
    processNotification(data.id);
};

export const processNotification = async (id: string) => {
    const supabase = getSupabase();
    const { data: notification, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !notification) return;

    try {
        let success = false;
        let errorMsg = '';

        if (notification.channel === 'email') {
            const { data, error } = await supabase.auth.admin.getUserById(notification.user_id);
            if (data?.user?.email) {
                if (notification.event_type === 'critical_detected') {
                    await sendCriticalAlertEmail(data.user.email, 'Repository', notification.payload.vulns, notification.payload.score);
                } else {
                    await sendScanCompletionEmail(data.user.email, 'Repository', notification.payload.score);
                }
                success = true;
            }
        } else if (notification.channel === 'slack') {
            const res = await sendSlackWebhook(notification.payload.webhook_url, notification.payload.message);
            success = res.success;
            errorMsg = res.error || '';
        } else if (notification.channel === 'discord') {
            const res = await sendDiscordWebhook(notification.payload.webhook_url, notification.payload.message);
            success = res.success;
            errorMsg = res.error || '';
        }

        if (success) {
            await supabase.from('notifications').update({
                status: 'sent',
                sent_at: new Date().toISOString()
            }).eq('id', id);
        } else {
            throw new Error(errorMsg || 'Failed to send');
        }
    } catch (err: any) {
        const retryCount = (notification.retry_count || 0) + 1;
        const status = retryCount > 3 ? 'failed' : 'pending';

        await supabase.from('notifications').update({
            status,
            retry_count: retryCount,
            last_error: err.message
        }).eq('id', id);

        if (status === 'pending') {
            // Retry after delay
            setTimeout(() => processNotification(id), 5000 * Math.pow(2, retryCount));
        }
    }
};
