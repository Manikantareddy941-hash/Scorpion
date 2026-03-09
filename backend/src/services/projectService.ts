import { createClient } from '@supabase/supabase-js';
import { triggerScan } from './scanService';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// -----------------------------------------------------------------------------
// CREATE PROJECT
// -----------------------------------------------------------------------------
export const createProject = async (
    userId: string,
    name: string,
    description?: string
) => {
    const { data, error } = await supabase
        .from('projects')
        .insert({
            user_id: userId,
            name,
            description,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .select()
        .single();

    return { data, error };
};

// -----------------------------------------------------------------------------
// GET PROJECTS
// -----------------------------------------------------------------------------
export const getProjects = async (userId: string) => {
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    return { data, error };
};

// -----------------------------------------------------------------------------
// PROJECT DASHBOARD DATA
// -----------------------------------------------------------------------------
export const getProjectDashboard = async (
    projectId: string,
    userId: string
) => {
    const { data: project, error: projectErr } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .eq('user_id', userId)
        .single();

    if (projectErr || !project) {
        return { error: projectErr || 'Project not found' };
    }

    const { data: repos, error: reposErr } = await supabase
        .from('repositories')
        .select('id, name, url, risk_score, vulnerability_count')
        .eq('project_id', projectId);

    if (reposErr) return { error: reposErr };

    const totalRepos = repos.length;
    const totalVulns = repos.reduce(
        (acc, r) => acc + (r.vulnerability_count || 0),
        0
    );

    const avgRiskScore =
        totalRepos > 0
            ? repos.reduce((acc, r) => acc + (Number(r.risk_score) || 0), 0) /
            totalRepos
            : 0;

    return {
        data: {
            project,
            stats: {
                totalRepos,
                totalVulns,
                avgRiskScore: Math.round(avgRiskScore * 100) / 100,
            },
            repositories: repos,
        },
    };
};

// -----------------------------------------------------------------------------
// IMPORT REPO + AUTO SCAN
// -----------------------------------------------------------------------------
export const importRepoToProject = async (
    projectId: string,
    userId: string,
    url: string
) => {
    // verify ownership
    const { data: project, error: projectErr } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', userId)
        .single();

    if (projectErr || !project) {
        return { error: 'Project not found or access denied' };
    }

    // insert repo
    const { data, error } = await supabase
        .from('repositories')
        .upsert(
            {
                user_id: userId,
                project_id: projectId,
                url,
                name: url.split('/').pop(),
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,url' }
        )
        .select()
        .single();

    if (error || !data) {
        return { error };
    }

    // 🔥 AUTO TRIGGER SCAN
    try {
        await triggerScan(data.id);
    } catch (scanErr) {
        console.error('Auto scan failed:', scanErr);
    }

    return { data, error: null };
};

// -----------------------------------------------------------------------------
// PROJECT SCAN HISTORY
// -----------------------------------------------------------------------------
export const getProjectScanHistory = async (
    projectId: string,
    userId: string
) => {
    const { data: repos } = await supabase
        .from('repositories')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', userId);

    if (!repos || repos.length === 0) return { data: [] };

    const repoIds = repos.map((r) => r.id);

    const { data, error } = await supabase
        .from('scan_results')
        .select('*, repositories(name)')
        .in('repo_id', repoIds)
        .order('created_at', { ascending: false })
        .limit(20);

    return { data, error };
};