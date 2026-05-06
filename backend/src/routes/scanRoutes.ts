import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { triggerImmediateScan } from '../workers/scanWorker';

const router = Router();

// Trigger immediate scan for a repo
router.post('/trigger', verifyUser, async (req: Request, res: Response) => {
    try {
        const { repo_id } = req.body;
        if (!repo_id) return res.status(400).json({ error: 'repo_id is required' });

        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repo_id);
        
        // Check ownership
        if (repo.user_id !== (req as any).user?.$id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Trigger scan in background
        triggerImmediateScan(repo);

        res.json({ message: 'Scan triggered successfully' });
    } catch (err: any) {
        console.error('[Scan Trigger Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
