import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, Query, COLLECTIONS, ID } from '../lib/appwrite';
import { Permission, Role } from 'node-appwrite';
import { verifyUser } from '../middleware/auth';
import { enqueueScan } from '../queues/scanQueue';
import { canAccessResource } from '../services/tenancyService';
import { scanTriggerLimiter } from '../middleware/rateLimiters';
import { logger, errorContext } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Trigger immediate scan for a repo
router.post('/trigger', verifyUser, scanTriggerLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { repo_id } = req.body;
        if (!repo_id) return res.status(400).json({ error: 'repo_id is required' });

        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repo_id);

        // Check ownership
        if (!(await canAccessResource(repo, req.user?.$id))) {
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
        const ownerUserId = req.user!.$id;
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
        // Document-level read for the owner so the browser session can receive
        // realtime events for this scan (documentSecurity: true on the collection
        // means realtime only delivers to sessions that can read the document).
        }, [Permission.read(Role.user(ownerUserId))]);
        const scanId = scan.$id;

        // Trigger scan in background via the scan queue
        enqueueScan(repo_id, {}, scanId).catch(err => {
            logger.error('[ScanRoutes] failed to enqueue scan', {
            event: 'SCAN_ENQUEUE_FAILED',
            scanId,
            ...errorContext(err),
        });
        });

        res.json({ scanId, message: 'Scan triggered successfully', status: 'pending' });
    } catch (err: unknown) {
        logger.error('[Scan Trigger Error]', errorContext(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
