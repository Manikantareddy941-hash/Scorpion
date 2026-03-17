import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { getEffectivePolicy } from '../services/policyService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Get active policy for a repository
router.get('/:id/policy', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const policy = await getEffectivePolicy(repoId);
        res.json(policy);
    } catch (err) {
        next(err);
    }
});

// Update policy for a repository (Override)
router.put('/:id/policy', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { policy_id, custom_max_critical, custom_max_high, custom_min_risk_score } = req.body;

        // Check for existing override
        const existing = await databases.listDocuments(DB_ID, COLLECTIONS.POLICY_EVALUATIONS, [
            Query.equal('repo_id', repoId),
            Query.limit(1)
        ]);

        let data;
        if (existing.total > 0) {
            data = await databases.updateDocument(DB_ID, COLLECTIONS.POLICY_EVALUATIONS, existing.documents[0].$id, {
                policy_id,
                custom_max_critical,
                custom_max_high,
                custom_min_risk_score,
                updated_at: new Date().toISOString()
            });
        } else {
            data = await databases.createDocument(DB_ID, COLLECTIONS.POLICY_EVALUATIONS, ID.unique(), {
                repo_id: repoId,
                policy_id,
                custom_max_critical,
                custom_max_high,
                custom_min_risk_score,
                updated_at: new Date().toISOString()
            });
        }

        res.json(data);
    } catch (err) {
        next(err);
    }
});

export default router;
