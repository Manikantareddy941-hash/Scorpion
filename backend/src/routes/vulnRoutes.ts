import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { getRemediationFix } from '../services/aiService';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { canAccessResource } from '../services/tenancyService';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// AI Auto-Remediation PR feature
router.post('/:id/remediate', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const vulnerabilityId = req.params.id;
        logger.info(`[Remediation] Triggering AI remediation for: ${vulnerabilityId}`);

        const vuln = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vulnerabilityId);
        const userId = req.user?.$id;
        const repo = vuln.repo_id ? await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, vuln.repo_id).catch(() => null) : null;
        if (!repo || !(await canAccessResource(repo, userId))) {
            return res.status(403).json({ error: 'You do not have access to this vulnerability' });
        }

        const fix = await getRemediationFix(vulnerabilityId);
        
        // Map internal Appwrite document to the format expected by the frontend
        res.json({
            id: `ai_${vulnerabilityId}_${Date.now()}`,
            technical_analysis: fix.technical_analysis,
            diff: fix.diff,
            impact_assessment: fix.impact_assessment,
            confidence: fix.confidence,
            vulnerability_id: vulnerabilityId
        });
    } catch (err) {
        logger.error(`[Remediation] Error generating fix:`, err);
        next(err);
    }
});

export default router;
