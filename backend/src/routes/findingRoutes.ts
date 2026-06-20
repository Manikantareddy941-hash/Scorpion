import { Router, Response, Request } from 'express';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logAuditEvent } from '../utils/auditLogger';
import { canAccessResource } from '../services/tenancyService';

const router = Router();

// Update finding status (e.g., mark as resolved)
router.patch('/:id', verifyUser, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const userId = (req as any).user?.$id;
        const existingFinding = await databases.getDocument(DB_ID, 'findings', id);
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, existingFinding.repo_id);
        if (!(await canAccessResource(repo, userId))) {
            return res.status(403).json({ error: 'You do not have access to this finding' });
        }

        const updatedFinding = await databases.updateDocument(
            DB_ID,
            'findings',
            id,
            { status }
        );

        await logAuditEvent('FINDING_RESOLVED', `Security finding "${updatedFinding.title}" marked as ${status}`, userId, updatedFinding.repo_id);

        res.json(updatedFinding);
    } catch (err: any) {
        console.error('[Finding API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
