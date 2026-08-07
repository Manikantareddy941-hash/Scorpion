import { Router, Response, Request } from 'express';
import { databases, DB_ID, ID, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { enqueueNucleiScan } from '../queues/nucleiQueue';
import { assertSafeScanTarget } from '../utils/ssrfGuard';
import { logger, errorContext, errorMessage } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: { $id: string };
}

function errorCode(err: unknown): number | undefined {
    return typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: number }).code : undefined;
}

const router = Router();

router.post('/nuclei', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    const { target_url, tags } = req.body;
    if (!target_url) return res.status(400).json({ error: 'target_url is required' });
    if (tags !== undefined && typeof tags !== 'string') {
        return res.status(400).json({ error: 'tags must be a comma-separated string when provided' });
    }
    try {
        await assertSafeScanTarget(target_url);
    } catch (err: unknown) {
        return res.status(400).json({ error: errorMessage(err) });
    }

    try {
        const scanId = ID.unique();
        const userId = req.user?.$id || 'system';

        logger.info(`[Nuclei API] Initializing scan for ${target_url}...`);

        await databases.createDocument(
            DB_ID,
            COLLECTIONS.SCANS,
            scanId,
            {
                repo_id: 'dast',
                user_id: userId,
                status: 'pending',
                scan_type: 'dast',
                repoUrl: target_url,
                startedAt: new Date().toISOString(),
                timestamp: new Date().toISOString(),
                scannerVersion: 'nuclei',
                visibility: 'private',
                details: JSON.stringify({ target: target_url, tags: tags || null })
            }
        );

        await enqueueNucleiScan({
            targetUrl: target_url,
            tags: tags || undefined,
            scanId,
            userId
        });

        res.json({ scanId, status: 'started' });

    } catch (err: unknown) {
        logger.error('[Nuclei API Error]', errorContext(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/nuclei/:scanId/status', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    const { scanId } = req.params;
    if (!scanId) return res.status(400).json({ error: 'scanId is required' });

    try {
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        if (scan.user_id !== req.user?.$id) {
            return res.status(403).json({ error: 'You do not have access to this scan' });
        }
        res.json({
            status: scan.status,
            completedAt: scan.completedAt || null,
            details: scan.details ? JSON.parse(scan.details) : null
        });
    } catch (err: unknown) {
        if (errorCode(err) === 404) return res.status(404).json({ error: 'Scan not found' });
        logger.error('[Nuclei API Status Error]', errorContext(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
