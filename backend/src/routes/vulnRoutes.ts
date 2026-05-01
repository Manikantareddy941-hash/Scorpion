import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { getRemediationFix } from '../services/aiService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// AI Auto-Remediation PR feature
router.post('/:id/remediate', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const vulnerabilityId = req.params.id;
        console.log(`[Remediation] Triggering AI remediation for: ${vulnerabilityId}`);
        
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
        console.error(`[Remediation] Error generating fix:`, err);
        next(err);
    }
});

export default router;
