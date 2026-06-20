import { Request } from 'express';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

/**
 * Multi-tenancy boundary built on the existing Team/TeamMember model.
 *
 * Resources (repositories, and anything keyed off repo_id) are owned by
 * either a single user (user_id, the default/personal scope) or a team
 * (team_id). A client opts into team scope by sending x-active-team-id;
 * absent that header, behavior is unchanged from the pre-tenancy model.
 */

export const ACTIVE_TEAM_HEADER = 'x-active-team-id';

export const getActiveTeamId = (req: Request): string | null => {
    const teamId = req.headers[ACTIVE_TEAM_HEADER];
    return typeof teamId === 'string' && teamId.length > 0 ? teamId : null;
};

export const isTeamMember = async (teamId: string, userId: string): Promise<boolean> => {
    try {
        const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
            Query.equal('team_id', teamId),
            Query.equal('user_id', userId),
            Query.limit(1)
        ]);
        return memberships.total > 0;
    } catch {
        return false;
    }
};

export class TenantAccessError extends Error {}

/**
 * Resolves the Appwrite query filter to scope a list/create request by.
 * Throws TenantAccessError if an x-active-team-id header is present but the
 * caller isn't a member of that team.
 */
export const resolveOwnershipScope = async (
    req: Request,
    userId: string
): Promise<{ field: 'team_id' | 'user_id'; value: string }> => {
    const activeTeamId = getActiveTeamId(req);
    if (!activeTeamId) {
        return { field: 'user_id', value: userId };
    }
    if (!(await isTeamMember(activeTeamId, userId))) {
        throw new TenantAccessError(`Not a member of team ${activeTeamId}`);
    }
    return { field: 'team_id', value: activeTeamId };
};

/**
 * Returns the fields to stamp onto a newly created resource: the creating
 * user, plus the active team if one is selected (and verified).
 */
export const resolveCreationOwnership = async (
    req: Request,
    userId: string
): Promise<{ user_id: string; team_id: string | null }> => {
    const scope = await resolveOwnershipScope(req, userId);
    return {
        user_id: userId,
        team_id: scope.field === 'team_id' ? scope.value : null
    };
};

/**
 * True if userId may access a resource that carries user_id/team_id fields
 * (e.g. a repository document) — either as the direct owner, or as a member
 * of the owning team.
 */
export const canAccessResource = async (
    resource: { user_id?: string; team_id?: string } & Record<string, any>,
    userId: string
): Promise<boolean> => {
    if (resource.user_id === userId) return true;
    if (resource.team_id) return isTeamMember(resource.team_id, userId);
    return false;
};
