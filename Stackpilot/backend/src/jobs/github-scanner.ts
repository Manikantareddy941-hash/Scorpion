import { createClient } from '@supabase/supabase-js';
import { triggerScan } from '../services/scanService';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl) throw new Error('SUPABASE_URL is required');
    return createClient(supabaseUrl, supabaseKey);
};

export const scanRepositories = async () => {
    console.log('[Scanner] Starting repository scan cycle...');
    const supabase = getSupabase();

    // 1. Fetch repositories that haven't been scanned in 24h
    // (Rate limiting cooldown is also handled inside triggerScan)
    const { data: repos, error } = await supabase
        .from('repositories')
        .select('id, url')
        .order('last_scan_at', { ascending: true, nullsFirst: true })
        .limit(5);

    if (error) {
        console.error('[Scanner] Failed to fetch repositories:', error);
        return;
    }

    if (!repos || repos.length === 0) {
        console.log('[Scanner] No repositories pending scan.');
        return;
    }

    // 2. Trigger scan for each repo using service
    for (const repo of repos) {
        console.log(`[Scanner] Triggering scan for ${repo.url}...`);
        const { error: scanError } = await triggerScan(repo.id);

        if (scanError) {
            console.error(`[Scanner] Failed to scan ${repo.url}: ${scanError}`);
        } else {
            console.log(`[Scanner] Successfully finished scan for ${repo.url}`);
        }
    }
};
