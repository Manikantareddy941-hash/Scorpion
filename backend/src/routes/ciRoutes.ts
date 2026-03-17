import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { triggerScan } from '../services/scanService';
import { linkCommitToScan } from '../services/gitTraceabilityService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Trigger scan via CI/CD
router.post('/scan', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { repo_url, commit_hash, branch, pr_number } = req.body;
    if (!repo_url) return res.status(400).json({ error: 'repo_url is required' });

    try {
        const userId = req.user!.$id;
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId),
            Query.equal('url', repo_url),
            Query.limit(1)
        ]);

        if (repos.total === 0) {
            return res.status(404).json({ error: 'Repository not connected to StackPilot. Please add it via the dashboard first.' });
        }

        const repo = repos.documents[0];

        const { scanId, error: scanErr } = await triggerScan(repo.$id);
        if (scanErr) return res.status(400).json({ error: scanErr });

        if (commit_hash) {
            await linkCommitToScan(scanId, repo.$id, { commit_hash, branch, pr_number });
        }

        res.json({ scanId, message: 'CI scan triggered successfully' });
    } catch (err) {
        next(err);
    }
});

// Get scan status for CI polling
router.get('/scans/:id/status', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, req.params.id);
        if (!scan) return res.status(404).json({ error: 'Scan not found' });

        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, scan.repo_id);
        if (repo.user_id !== req.user!.$id) {
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
