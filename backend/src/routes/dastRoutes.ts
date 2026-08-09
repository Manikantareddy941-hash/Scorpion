import { Router, Response, Request } from 'express';
import { databases, DB_ID, ID, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { enqueueDastScan } from '../queues/dastQueue';
import { assertSafeScanTarget } from '../utils/ssrfGuard';
import { logger, errorContext, errorMessage } from '../services/logger';

const VALID_SCAN_MODES = ['spider', 'active', 'passive'] as const;
type ScanMode = (typeof VALID_SCAN_MODES)[number];

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: { $id: string };
}

function errorCode(err: unknown): number | undefined {
    return typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: number }).code : undefined;
}

const router = Router();

router.post('/dast', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    const { target_url, scanMode = 'spider', auth } = req.body;
    if (!target_url) return res.status(400).json({ error: 'target_url is required' });
    if (!VALID_SCAN_MODES.includes(scanMode)) {
        return res.status(400).json({ error: `scanMode must be one of: ${VALID_SCAN_MODES.join(', ')}` });
    }
    if (auth !== undefined && typeof auth?.bearerToken !== 'string') {
        return res.status(400).json({ error: 'auth.bearerToken must be a string when auth is provided' });
    }
    try {
        await assertSafeScanTarget(target_url);
    } catch (err: unknown) {
        return res.status(400).json({ error: errorMessage(err) });
    }

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

        // Hand off to the BullMQ worker: survives restarts, retries on failure.
        await enqueueDastScan({
            targetUrl: target_url,
            scanMode: scanMode as ScanMode,
            scanId,
            userId,
            auth: auth ? { bearerToken: auth.bearerToken } : undefined
        });

        res.json({ scanId, status: 'started' });

    } catch (err: unknown) {
        logger.error('[DAST API Error]', { event: 'DAST_SCAN_START_FAILED', ...errorContext(err) });
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
        logger.error('[DAST API Status Error]', { event: 'DAST_SCAN_STATUS_READ_FAILED', scanId, ...errorContext(err) });
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
