import { createClient } from '@supabase/supabase-js';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    return createClient(supabaseUrl, supabaseKey);
};

export type Role = 'owner' | 'admin' | 'developer' | 'viewer';

const rolePriority: Record<Role, number> = {
    'owner': 4,
    'admin': 3,
    'developer': 2,
    'viewer': 1
};

/**
 * Resolves the effective role for a user on a specific repository.
 */
export const getUserEffectiveRole = async (userId: string, repoId: string): Promise<Role | null> => {
    const supabase = getSupabase();

    // 1. Check if user is the direct owner of the repository
    const { data: repo, error: repoErr } = await supabase
        .from('repositories')
        .select('user_id')
        .eq('id', repoId)
        .single();

    if (repoErr || !repo) return null;
    if (repo.user_id === userId) return 'owner';

    // 2. Check team-based access
    // Find all teams the user is in and that have access to this repo
    const { data: memberRoles, error: memErr } = await supabase
        .from('team_members')
        .select(`
            role,
            team_id,
            teams!inner(
                id,
                project_access!inner(repo_id)
            )
        `)
        .eq('user_id', userId)
        .eq('teams.project_access.repo_id', repoId);

    if (memErr || !memberRoles || memberRoles.length === 0) return null;

    // Return the highest role found across all teams
    let highestRole: Role = 'viewer';
    memberRoles.forEach((mr: any) => {
        if (rolePriority[mr.role as Role] > rolePriority[highestRole]) {
            highestRole = mr.role as Role;
        }
    });

    return highestRole;
};

/**
 * Checks if a user has at least the required role for a repository.
 */
export const hasRequiredRole = async (userId: string, repoId: string, requiredRole: Role): Promise<boolean> => {
    const effectiveRole = await getUserEffectiveRole(userId, repoId);
    if (!effectiveRole) return false;

    return rolePriority[effectiveRole] >= rolePriority[requiredRole];
};

/**
 * Records an RBAC action in the audit log.
 */
export const logRbacAction = async (data: {
    action: string;
    actor_id: string;
    target_user_id?: string;
    team_id?: string;
    repo_id?: string;
    details?: any;
}) => {
    const supabase = getSupabase();
    const { error } = await supabase
        .from('rbac_audit_log')
        .insert(data);

    if (error) {
        console.error('[RBAC] Failed to log action:', error);
    }
};
