import { Request, Response, NextFunction } from 'express';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { evaluateIAM, DEFAULT_IAM_POLICY, ADMIN_IAM_POLICY, IAMStatement } from '../services/policyService';

export interface IAMRequest extends Request {
    user?: {
        $id: string;
        email: string;
        name?: string;
    };
    activeTeamId?: string;
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

            // Active team context
            const activeTeamId = req.headers['x-active-team-id'] as string || req.body.team_id || req.query.team_id || '';

            let statements: IAMStatement[] = [];

            if (activeTeamId) {
                try {
                    const teamDoc = await databases.getDocument(DB_ID, COLLECTIONS.TEAMS, activeTeamId);
                    
                    // Verify membership
                    const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
                        Query.equal('team_id', activeTeamId),
                        Query.equal('user_id', user.$id),
                        Query.limit(1)
                    ]);

                    if (memberships.total > 0) {
                        const userRole = memberships.documents[0].role;
                        
                        if (teamDoc.policy) {
                            try {
                                statements = typeof teamDoc.policy === 'string' ? JSON.parse(teamDoc.policy) : teamDoc.policy;
                            } catch {
                                // Fallback if JSON format inside db is corrupt
                                statements = ['admin', 'owner'].includes(userRole) ? ADMIN_IAM_POLICY : DEFAULT_IAM_POLICY;
                            }
                        } else {
                            statements = ['admin', 'owner'].includes(userRole) ? ADMIN_IAM_POLICY : DEFAULT_IAM_POLICY;
                        }
                    } else {
                        return res.status(403).json({ 
                            error: `Forbidden: User is not a member of the requested battalion '${activeTeamId}'` 
                        });
                    }
                } catch (err: any) {
                    console.warn(`[IAM Middleware] Failed to retrieve team policy for ${activeTeamId}:`, err.message);
                    statements = DEFAULT_IAM_POLICY;
                }
            } else {
                // If no team context is passed, check if mock user or default fallback
                const isLocal = user.$id === 'mock-local-developer';
                statements = isLocal ? ADMIN_IAM_POLICY : DEFAULT_IAM_POLICY;
            }

            // Check permissions
            const isAuthorized = evaluateIAM(statements, action, resourceId);

            if (!isAuthorized) {
                return res.status(403).json({
                    error: `Forbidden: User is unauthorized to perform action '${action}' on resource '${resourceId}'`
                });
            }

            next();
        } catch (err: any) {
            console.error('[IAM Middleware] Enforcement failure:', err);
            return res.status(500).json({ error: 'Internal policy enforcement failure' });
        }
    };
};
