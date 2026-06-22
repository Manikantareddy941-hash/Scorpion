import { Router, Response, Request } from 'express';
import { databases, DB_ID, ID, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { runZapScan } from '../workers/zapWorker';
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

router.post('/dast', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    const { target_url, scanMode = 'spider' } = req.body;
    if (!target_url) return res.status(400).json({ error: 'target_url is required' });

    try {
        const scanId = ID.unique();
        const userId = req.user?.$id || 'system';

        logger.info(`[DAST API] Initializing ZAP scan for ${target_url} (Mode: ${scanMode})...`);
        
        // Create initial scan document
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
                scannerVersion: 'ZAP',
                visibility: 'private',
                details: JSON.stringify({ target: target_url, mode: scanMode })
            }
        );

        // Run worker asynchronously
        runZapScan({
            targetUrl: target_url,
            scanMode,
            scanId,
            userId
        }).catch(err => {
            logger.error('[DAST API Worker Error]', err);
        });

        res.json({ scanId, status: 'started' });

    } catch (err: unknown) {
        logger.error('[DAST API Error]', errorMessage(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/dast/:scanId/status', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
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
        logger.error('[DAST API Status Error]', errorMessage(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
