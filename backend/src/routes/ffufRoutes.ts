import { Router, Response, Request } from 'express';
import { databases, DB_ID, ID, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { enqueueFfufScan } from '../queues/ffufQueue';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request {
    user?: { $id: string };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

function errorCode(err: unknown): number | undefined {
    return typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: number }).code : undefined;
}

const router = Router();

router.post('/ffuf', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    const { target_url, rate } = req.body;
    if (!target_url) return res.status(400).json({ error: 'target_url is required' });
    if (rate !== undefined && (typeof rate !== 'number' || rate <= 0)) {
        return res.status(400).json({ error: 'rate must be a positive number when provided' });
    }

    try {
        const scanId = ID.unique();
        const userId = req.user?.$id || 'system';

        logger.info(`[ffuf API] Initializing fuzz for ${target_url}...`);

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
                scannerVersion: 'ffuf',
                visibility: 'private',
                details: JSON.stringify({ target: target_url, rate: rate ?? null })
            }
        );

        await enqueueFfufScan({
            targetUrl: target_url,
            rate: typeof rate === 'number' ? rate : undefined,
            scanId,
            userId
        });

        res.json({ scanId, status: 'started' });

    } catch (err: unknown) {
        logger.error('[ffuf API Error]', errorMessage(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/ffuf/:scanId/status', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
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
        logger.error('[ffuf API Status Error]', errorMessage(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
