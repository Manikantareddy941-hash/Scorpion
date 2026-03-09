import { databases, COLLECTIONS, DB_ID, Query, ID } from '../lib/appwrite';

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
        if (repo.user_id === userId) return 'owner';

        // 2. Check team-based access
        // Find project access records for this repo
        const accessRes = await databases.listDocuments(
            DB_ID,
            'project_access',
            [Query.equal('repo_id', repoId)]
        );

        if (accessRes.total === 0) return null;

        // Get teams user belongs to
        const memberRes = await databases.listDocuments(
            DB_ID,
            'team_members',
            [Query.equal('user_id', userId)]
        );

        if (memberRes.total === 0) return null;

        const userTeams = memberRes.documents;
        const permittedTeams = accessRes.documents;

        let highestRole: Role = 'viewer';
        let found = false;

        permittedTeams.forEach((access: any) => {
            const membership = userTeams.find((m: any) => m.team_id === access.team_id);
            if (membership) {
                found = true;
                if (rolePriority[membership.role as Role] > rolePriority[highestRole]) {
                    highestRole = membership.role as Role;
                }
            }
        });

        return found ? highestRole : null;
    } catch (err) {
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
    details?: string;
}) => {
    try {
        await databases.createDocument(
            DB_ID,
            COLLECTIONS.AUDIT_LOGS,
            ID.unique(),
            {
                ...data,
                created_at: new Date().toISOString()
            }
        );
    } catch (error) {
        console.error('[RBAC] Failed to log action:', error);
    }
};
