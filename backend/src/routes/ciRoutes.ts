import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { enqueueScan } from '../queues/scanQueue';
import { resolveOwnershipScope, canAccessResource, TenantAccessError } from '../services/tenancyService';
import { linkCommitToScan } from '../services/gitTraceabilityService';
import { logger, errorContext } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Trigger scan via CI/CD
router.post('/scan', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { repo_url, commit_hash, branch, pr_number } = req.body;
    if (!repo_url) return res.status(400).json({ error: 'repo_url is required' });

    try {
        const userId = req.user!.$id;
        const scope = await resolveOwnershipScope(req, userId);
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal(scope.field, scope.value),
            Query.equal('url', repo_url),
            Query.limit(1)
        ]);

        if (repos.total === 0) {
            return res.status(404).json({ error: 'Repository not connected to StackPilot. Please add it via the dashboard first.' });
        }

        const repo = repos.documents[0];

        const activeScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repo.$id),
            Query.equal('status', ['pending', 'running']),
            Query.limit(1)
        ]);
        if (activeScans.total > 0) {
            return res.status(409).json({ error: 'A scan is already in progress for this repository' });
        }

        const startedAt = new Date().toISOString();
        const scan = await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
            repo_id: repo.$id,
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
            details: JSON.stringify({ started_at: startedAt, target: repo.url, branch: branch || 'main' })
        });
        const scanId = scan.$id;

        enqueueScan(repo.$id, { branch }, scanId).catch(err => {
            logger.error('[CiRoutes] failed to enqueue scan', {
            event: 'SCAN_ENQUEUE_FAILED',
            scanId,
            ...errorContext(err),
        });
        });

        if (commit_hash) {
            await linkCommitToScan(scanId, repo.$id, { commit_hash, branch, pr_number });
        }

        res.json({ scanId, message: 'CI scan queued', status: 'pending' });
    } catch (err) {
        if (err instanceof TenantAccessError) return res.status(403).json({ error: err.message });
        next(err);
    }
});

// Get scan status for CI polling
router.get('/scans/:id/status', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, req.params.id);
        if (!scan) return res.status(404).json({ error: 'Scan not found' });

        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, scan.repo_id);
        if (!(await canAccessResource(repo, req.user!.$id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const isFinished = scan.status === 'completed' || scan.status === 'failed';
        const pass = scan.status === 'completed' && (scan.details?.critical_count || 0) === 0;

        res.json({
            id: scan.$id,
            status: scan.status,
            finished: isFinished,
            pass: isFinished ? pass : null,
            details: scan.details || {}
        });
    } catch (err) {
        next(err);
    }
});

export default router;
