import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query, COLLECTIONS, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { enqueueScan } from '../queues/scanQueue';
import { canAccessResource } from '../services/tenancyService';
import { logger } from '../services/logger';

const router = Router();

// Trigger immediate scan for a repo
router.post('/trigger', verifyUser, async (req: Request, res: Response) => {
    try {
        const { repo_id } = req.body;
        if (!repo_id) return res.status(400).json({ error: 'repo_id is required' });

        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repo_id);

        // Check ownership
        if (!(await canAccessResource(repo, (req as any).user?.$id))) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const activeScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repo_id),
            Query.equal('status', ['pending', 'running']),
            Query.limit(1)
        ]);
        if (activeScans.total > 0) {
            return res.status(409).json({ error: 'A scan is already in progress for this repository' });
        }

        if (!repo.url) return res.status(400).json({ error: 'Repository URL missing' });

        const startedAt = new Date().toISOString();
        const scan = await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
            repo_id,
            status: 'pending',
            scan_type: 'full',
            repoUrl: repo.url,
            startedAt,
            timestamp: startedAt,
            scannerVersion: '1.0.0',
            visibility: 'public',
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            details: JSON.stringify({ started_at: startedAt, target: repo.url })
        });
        const scanId = scan.$id;

        // Trigger scan in background via the scan queue
        enqueueScan(repo_id, {}, scanId).catch(err => {
            logger.error(`[ScanRoutes] Failed to enqueue scan for scanId=${scanId}:`, err.message);
        });

        res.json({ scanId, message: 'Scan triggered successfully', status: 'pending' });
    } catch (err: any) {
        logger.error('[Scan Trigger Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
