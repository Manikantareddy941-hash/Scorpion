import { createClient } from '@supabase/supabase-js';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    return createClient(supabaseUrl, supabaseKey);
};

export interface GitMetadata {
    commit_hash: string;
    branch?: string;
    pr_number?: number;
}

/**
 * Links a scan execution to specific Git metadata.
 */
export const linkCommitToScan = async (scanId: string, repoId: string, metadata: GitMetadata) => {
    const supabase = getSupabase();

    const { error } = await supabase
        .from('scan_commits')
        .insert({
            scan_id: scanId,
            repo_id: repoId,
            commit_hash: metadata.commit_hash,
            branch: metadata.branch,
            pr_number: metadata.pr_number
        });

    if (error) {
        console.error(`[GitTraceability] Failed to link commit to scan ${scanId}:`, error);
        throw error;
    }

    console.log(`[GitTraceability] Scan ${scanId} linked to commit ${metadata.commit_hash.substring(0, 7)}`);
};

/**
 * Fetches the historical lifecycle of a finding.
 */
export const getFindingHistory = async (findingId: string) => {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('finding_resolutions')
        .select('*, auth.users(email)')
        .eq('finding_id', findingId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
};

/**
 * Generates a stable fingerprint for a finding based on tool, file, and message.
 */
export const generateFingerprint = (f: { tool: string, file_path: string, message: string }): string => {
    // Basic deterministic string for tracking across scans
    return `${f.tool}:${f.file_path}:${Buffer.from(f.message).toString('base64').substring(0, 32)}`;
};
