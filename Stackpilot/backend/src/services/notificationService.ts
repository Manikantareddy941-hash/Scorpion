import { createClient } from '@supabase/supabase-js';
import { enqueueNotification } from './notificationQueue';
import { formatSlackScanResult } from './webhookService';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    return createClient(supabaseUrl, supabaseKey);
};

export const dispatchNotification = async (repoId: string, eventType: string, metadata: any) => {
    const supabase = getSupabase();

    // 1. Get repo and user info
    const { data: repo, error } = await supabase
        .from('repositories')
        .select('*, users(id, email)') // Note: adjusted to join users if possible or get user_id
        .eq('id', repoId)
        .single();

    if (error || !repo) return;

    const userId = repo.user_id;

    // 2. Fetch notification preferences
    const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .or(`repo_id.eq.${repoId},repo_id.is.null`)
        .eq('event_type', eventType)
        .eq('enabled', true);

    if (!prefs || prefs.length === 0) {
        // Default behavior if no preferences set?
        // Let's assume email is default for now for scan completions
        if (eventType === 'scan_completed') {
            // logic to enqueue default email
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
};

export const notifyScanCompletion = async (scanId: string) => {
    const supabase = getSupabase();
    const { data: scan, error } = await supabase
        .from('scan_results')
        .select('*, repositories(id, name, user_id)')
        .eq('id', scanId)
        .single();

    if (error || !scan) return;

    const score = scan.details?.security_score || 0;
    const vulns = scan.details?.total_vulnerabilities || 0;

    await dispatchNotification(scan.repo_id, 'scan_completed', { score, vulns });

    // Additional event if critical
    if (scan.details?.critical_count > 0) {
        await dispatchNotification(scan.repo_id, 'critical_detected', { score, vulns, critical: scan.details.critical_count });
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
