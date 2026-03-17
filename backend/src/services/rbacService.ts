import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';

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
    try {
        // 1. Check if user is the direct owner of the repository
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
        
        if (!repo) return null;
        if (repo.user_id === userId) return 'owner';

        // 2. Check team-based access
        // Find all teams the user is in
        const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
            Query.equal('user_id', userId)
        ]);

        if (memberships.total === 0) return null;

        const teamIds = memberships.documents.map(m => m.team_id);

        // Find if any of these teams have access to the repo
        const accessDocs = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_ACCESS, [
            Query.equal('repo_id', repoId),
            Query.equal('team_id', teamIds)
        ]);

        if (accessDocs.total === 0) return null;

        // Get the highest role from the user's memberships in teams that have access
        const accessibleTeamIds = new Set(accessDocs.documents.map(a => a.team_id));
        let highestRole: Role = 'viewer';
        let found = false;

        memberships.documents.forEach((m: any) => {
            if (accessibleTeamIds.has(m.team_id)) {
                found = true;
                if (rolePriority[m.role as Role] > rolePriority[highestRole]) {
                    highestRole = m.role as Role;
                }
            }
        });

        return found ? highestRole : null;
    } catch (err) {
        console.error('[RBAC] Error resolving role:', err);
        return null;
    }
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
    try {
        await databases.createDocument(DB_ID, COLLECTIONS.RBAC_AUDIT_LOGS || 'rbac_audit_logs', ID.unique(), {
            ...data,
            details: data.details ? JSON.stringify(data.details) : null,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('[RBAC] Failed to log action:', err);
    }
};
