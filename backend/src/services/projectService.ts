import { supabase } from '../lib/supabase';
import { triggerScan } from './scanService';

export const createProject = async (userId: string, name: string, description?: string) => {
    const { data, error } = await supabase
        .from('projects')
        .insert({
            user_id: userId,
            name,
            description,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    return { data, error };
};

export const getProjects = async (userId: string) => {
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    return { data, error };
};

export const getProjectDashboard = async (projectId: string, userId: string) => {
    // 1. Verify project ownership and get project details
    const { data: project, error: projectErr } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .eq('user_id', userId)
        .single();

    if (projectErr || !project) {
        return { error: projectErr || 'Project not found' };
    }

    // 2. Get repositories for this project
    const { data: repos, error: reposErr } = await supabase
        .from('repositories')
        .select('id, name, url, risk_score, vulnerability_count')
        .eq('project_id', projectId);

    if (reposErr) return { error: reposErr };

    // 3. Get all scans for these repos to calculate Patch Rate & Fix Time
    const repoIds = repos.map(r => r.id);
    const { data: scans } = await supabase
        .from('scan_results')
        .select('details, status')
        .in('repo_id', repoIds)
        .eq('status', 'completed');

    // 4. Aggregate stats
    const totalRepos = repos.length;
    const totalVulns = repos.reduce((acc, r) => acc + (r.vulnerability_count || 0), 0);

    // Get all vulnerabilities for these repos
    const { data: allVulns, error: vulnsErr } = await supabase
        .from('vulnerabilities')
        .select('created_at, updated_at, resolution_status, severity')
        .in('repo_id', repoIds);

    if (vulnsErr) return { error: vulnsErr };

    // Calculate Health Score (Avg Score across repos)
    const avgHealthScore = scans && scans.length > 0
        ? scans.reduce((acc, s) => acc + (s.details?.security_score || 0), 0) / scans.length
        : 100;

    // Calculate Patch Rate
    const resolvedVulns = allVulns?.filter((v: any) => v.resolution_status === 'resolved' || v.resolution_status === 'auto_closed').length || 0;
    const patchRate = allVulns && allVulns.length > 0 ? (resolvedVulns / allVulns.length) * 100 : 100;

    // Calculate Avg Fix Time (in hours)
    const fixTimes = allVulns?.filter((v: any) => (v.resolution_status === 'auto_closed' || v.resolution_status === 'resolved') && v.updated_at)
        .map((v: any) => (new Date(v.updated_at).getTime() - new Date(v.created_at).getTime()) / (1000 * 60 * 60)) || [];

    const avgFixTime = fixTimes.length > 0 ? fixTimes.reduce((a: number, b: number) => a + b, 0) / fixTimes.length : 0;

    const criticalRisks = allVulns?.filter((v: any) => v.severity === 'critical' && v.resolution_status === 'open').length || 0;

    return {
        data: {
            project,
            stats: {
                totalRepos,
                totalVulns,
                healthScore: Math.round(avgHealthScore),
                patchRate: Math.round(patchRate),
                avgFixTime: Math.round(avgFixTime),
                criticalRisks
            },
            repositories: repos
        }
    };
};

export const importRepoToProject = async (projectId: string, userId: string, url: string) => {
    // 1. Double check project ownership
    const { data: project, error: projectErr } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', userId)
        .single();

    if (projectErr || !project) return { error: 'Project not found or access denied' };

    // 2. Upsert repository and link to project
    const { data: repo, error } = await supabase
        .from('repositories')
        .upsert({
            user_id: userId,
            project_id: projectId,
            url,
            name: url.split('/').pop(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,url' })
        .select()
        .single();

    if (repo && !error) {
        // TRIGGER SCAN AUTOMATICALLY
        console.log(`[ProjectService] Triggering automatic scan for newly imported repo: ${repo.id}`);
        triggerScan(repo.id).catch(err => console.error('[ProjectService] Auto-scan trigger failed:', err));
    }

    return { data: repo, error };
};

export const getProjectScanHistory = async (projectId: string, userId: string) => {
    // Placeholder for scan history across all repos in a project
    const { data: repos } = await supabase
        .from('repositories')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', userId);

    if (!repos || repos.length === 0) return { data: [] };

    const repoIds = repos.map(r => r.id);

    const { data, error } = await supabase
        .from('scan_results')
        .select('*, repositories(name)')
        .in('repo_id', repoIds)
        .order('created_at', { ascending: false })
        .limit(20);

    return { data, error };
};
