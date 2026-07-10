import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logAuditEvent } from '../utils/auditLogger';
import { canAccessResource } from '../services/tenancyService';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

const router = Router();

// Update finding status (e.g., mark as resolved)
router.patch('/:id', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const userId = req.user?.$id || '';
        const existingFinding = await databases.getDocument(DB_ID, COLLECTIONS.FINDINGS, id);
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, existingFinding.repo_id);
        if (!(await canAccessResource(repo, userId))) {
            return res.status(403).json({ error: 'You do not have access to this finding' });
        }

        const wasResolved = existingFinding.status === 'resolved';
        const nowReopened = status !== 'resolved';
        const patch: Record<string, unknown> = { status };
        if (status === 'resolved') patch.resolvedAt = new Date().toISOString();
        if (wasResolved && nowReopened) patch.reopenCount = Number(existingFinding.reopenCount ?? 0) + 1;

        const updatedFinding = await databases.updateDocument(
            DB_ID,
            COLLECTIONS.FINDINGS,
            id,
            patch
        );

        await logAuditEvent('FINDING_RESOLVED', `Security finding "${updatedFinding.title}" marked as ${status}`, userId, updatedFinding.repo_id);

        res.json(updatedFinding);
    } catch (err: unknown) {
        logger.error('[Finding API Error]', errorMessage(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
