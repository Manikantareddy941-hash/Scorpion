import { Request, Response, NextFunction } from 'express';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { evaluateIAM, DEFAULT_IAM_POLICY, ADMIN_IAM_POLICY, IAMStatement } from '../services/policyService';
import { logger, errorContext, errorMessage } from '../services/logger';

export interface IAMRequest extends Request {
    user?: {
        $id: string;
        email: string;
        name?: string;
    };
    activeTeamId?: string;
}

/**
 * Resolves the IAM statements that apply to `userId` for this request's team
 * context (or lack thereof). Exported separately from checkPermission so
 * route handlers that only know the resource's owning repo after an earlier
 * lookup (e.g. resolving a buildId to its repoId) can call it directly
 * instead of needing resourceId available at Express-middleware time.
 */
export const resolveIamStatements = async (req: Request, userId: string, resourceId: string): Promise<IAMStatement[]> => {
    const activeTeamId = req.headers['x-active-team-id'] as string || req.body?.team_id || req.query?.team_id || '';

    if (activeTeamId) {
        try {
            const teamDoc = await databases.getDocument(DB_ID, COLLECTIONS.TEAMS, activeTeamId);

            const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
                Query.equal('team_id', activeTeamId),
                Query.equal('user_id', userId),
                Query.limit(1)
            ]);

            if (memberships.total === 0) {
                throw new IamNotATeamMemberError(activeTeamId);
            }

            const userRole = memberships.documents[0].role;
            if (teamDoc.policy) {
                try {
                    return typeof teamDoc.policy === 'string' ? JSON.parse(teamDoc.policy) : teamDoc.policy;
                } catch {
                    // A policy document that EXISTS but cannot be parsed is an
                    // unjudgeable authorization context, not an absent one.
                    // Falling through to the role default here meant a corrupt
                    // or tampered policy blob resolved to ADMIN_IAM_POLICY for
                    // any admin/owner — so the stricter a team's real policy
                    // was, the more a malformed one granted. Deny instead: the
                    // caller cannot be authorized against a policy nobody can
                    // read.
                    throw new IamPolicyUnreadableError(activeTeamId);
                }
            }
            return ['admin', 'owner'].includes(userRole) ? ADMIN_IAM_POLICY : DEFAULT_IAM_POLICY;
        } catch (err) {
            if (err instanceof IamNotATeamMemberError) throw err;
            if (err instanceof IamPolicyUnreadableError) throw err;
            // Reaching the policy store failed (Appwrite down, network, quota).
            // This used to return DEFAULT_IAM_POLICY, which is still a GRANT —
            // an outage silently re-authorized every request against a policy
            // set nobody had consulted, and said so at warn level. A check that
            // could not be performed is not a check that passed.
            logger.error(
                `[IAM Middleware] Could not retrieve team policy for ${activeTeamId} — denying (fail-closed)`,
                errorContext(err),
            );
            throw new IamPolicyUnavailableError(activeTeamId, errorMessage(err));
        }
    }

    // No team context: this is a personal resource. The direct owner of the
    // resource gets full control over it (matching what every other
    // ownership check in this codebase already grants), distinct from a
    // team member's role-based permissions on a shared resource. Without
    // this, DEFAULT_IAM_POLICY's narrow allow-list would lock every
    // individual user out of deploying/deleting their own repos, since
    // "owner of a personal repo" isn't the same thing as "owner role in a
    // team" that this policy set was actually designed around.
    const isLocal = userId === 'mock-local-developer';
    if (isLocal) return ADMIN_IAM_POLICY;

    if (resourceId && resourceId !== '*') {
        try {
            const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, resourceId);
            if (repo.user_id === userId) {
                return ADMIN_IAM_POLICY;
            }
        } catch {
            // Not a repository id (or doesn't exist) - fall through to the default policy.
        }
    }

    return DEFAULT_IAM_POLICY;
};

class IamNotATeamMemberError extends Error {
    constructor(public teamId: string) {
        super(`Not a member of team ${teamId}`);
    }
}

/**
 * The team's policy document was retrieved but is not parseable. Distinct from
 * IamPolicyUnavailableError on purpose: this one means "fix the data", the other
 * means "fix the policy store". Both deny; conflating them would send an
 * operator to the wrong system.
 */
export class IamPolicyUnreadableError extends Error {
    constructor(public teamId: string) {
        super(`Team ${teamId} has a policy document that could not be parsed — authorization denied`);
    }
}

/** The policy store could not be reached at all, so no policy could be applied. */
export class IamPolicyUnavailableError extends Error {
    constructor(public teamId: string, public cause: string) {
        super(`Team ${teamId} policy could not be retrieved (${cause}) — authorization denied`);
    }
}

/**
 * Express middleware to evaluate AWS-style IAM access controls
 */
export const checkPermission = (action: string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = (req as any).user;
            if (!user || !user.$id) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            // Extract resource context: check req.params, body, query
            const resourceId = req.params.repoId || req.params.id || req.body.repo_id || req.query.repo_id || '*';

            let statements: IAMStatement[];
            try {
                statements = await resolveIamStatements(req, user.$id, resourceId);
            } catch (err) {
                if (err instanceof IamNotATeamMemberError) {
                    return res.status(403).json({ error: `Forbidden: User is not a member of the requested battalion '${err.teamId}'` });
                }
                // Both remaining cases are denials, but they are different
                // incidents and get different codes so the response itself tells
                // an operator which system to go and fix.
                if (err instanceof IamPolicyUnreadableError) {
                    logger.error(`[IAM Middleware] Denied '${action}' — unparseable policy for team ${err.teamId}`, {
                        userId: user.$id, action, resourceId, teamId: err.teamId,
                    });
                    return res.status(403).json({
                        error: `Forbidden: the policy for battalion '${err.teamId}' could not be read, so no permission could be granted`,
                    });
                }
                if (err instanceof IamPolicyUnavailableError) {
                    logger.error(`[IAM Middleware] Denied '${action}' — policy store unreachable for team ${err.teamId}`, {
                        userId: user.$id, action, resourceId, teamId: err.teamId, cause: err.cause,
                    });
                    return res.status(503).json({
                        error: 'Authorization is temporarily unavailable: the policy store could not be reached. The request was denied rather than allowed.',
                    });
                }
                throw err;
            }

            // Check permissions
            const isAuthorized = evaluateIAM(statements, action, resourceId);

            if (!isAuthorized) {
                return res.status(403).json({
                    error: `Forbidden: User is unauthorized to perform action '${action}' on resource '${resourceId}'`
                });
            }

            next();
        } catch (err) {
            logger.error('[IAM Middleware] Enforcement failure', {
                event: 'IAM_ENFORCEMENT_FAILED',
                ...errorContext(err),
            });
            return res.status(500).json({ error: 'Internal policy enforcement failure' });
        }
    };
};

/**
 * Non-middleware variant for route handlers that only resolve the relevant
 * resourceId after an earlier lookup (e.g. resolving a buildId to its
 * owning repoId before checking 'repo:deploy').
 */
export const hasPermission = async (req: Request, userId: string, action: string, resourceId: string): Promise<boolean> => {
    const statements = await resolveIamStatements(req, userId, resourceId);
    return evaluateIAM(statements, action, resourceId);
};
