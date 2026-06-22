import { Router, Response, NextFunction } from 'express';
import { TenantAccessError } from '../services/tenancyService';
import { repoService } from '../services/repoService';
import { validateBody } from '../middleware/validate';
import { scanTriggerLimiter } from '../middleware/rateLimiters';
import { logger } from '../services/logger';
import { AuthenticatedRequest, addRepoSchema, externalScanSchema, triggerScanSchema } from '../types/repo.types';

const router = Router();

// Add/Sync repository
router.post('/', validateBody(addRepoSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { url } = req.body;

    try {
        const userId = req.user!.$id;
        const data = await repoService.syncRepo(req, userId, url);
        res.json(data);
    } catch (error: unknown) {
        if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
        next(error);
    }
});

// Delete a repository, cleaning up its on-disk workspace if it was a ZIP upload
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const result = await repoService.deleteRepo(req, req.user!.$id, repoId);

        if (result === 'forbidden') return res.status(403).json({ error: 'You do not have permission to delete this repository' });
        if (result === 'scan_in_progress') return res.status(409).json({ error: 'Cannot delete a repository with a scan in progress' });

        res.status(204).end();
    } catch (error: unknown) {
        if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
        next(error);
    }
});

// List repos
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id;
        res.json(await repoService.listRepos(req, userId));
    } catch (error: unknown) {
        if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
        next(error);
    }
});

// List repos from any provider (GitLab, Bitbucket, Azure)
router.get('/external', async (req: AuthenticatedRequest, res: Response) => {
    const provider = req.query.provider as string;
    const token = req.headers['x-provider-token'] as string;

    if (!provider || !token) return res.status(400).json({ error: 'Provider and x-provider-token header are required' });

    try {
        const repos = await repoService.listExternalRepos(provider, token);
        res.json({ repos });
    } catch (error) {
        logger.error(`[RepoRoutes] Failed to list ${provider} repos:`, error instanceof Error ? error.message : error);
        res.status(500).json({ error: `Failed to list ${provider} repositories` });
    }
});

// Trigger scan on any provider repo (Directly)
router.post('/external/scan', scanTriggerLimiter, validateBody(externalScanSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { provider, repoFullName, cloneUrl, branch = 'main' } = req.body;
    const token = req.headers['x-provider-token'] as string;

    if (!token) {
        return res.status(400).json({ error: 'x-provider-token header is required' });
    }

    try {
        const workDirName = repoService.triggerExternalScan(provider, repoFullName, cloneUrl, branch, token);
        // Respond immediately (Accepted) — the clone/scan/cleanup runs in the background
        res.status(202).json({ message: 'Scan triggered', workDir: workDirName });
    } catch (error) {
        next(error);
    }
});

// Trigger scan — fire and forget (respond immediately, scan runs in background)
router.post('/:id/scan', scanTriggerLimiter, validateBody(triggerScanSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const result = await repoService.triggerScan(req.user!.$id, repoId, req.body);

        if (result === 'scan_in_progress') return res.status(409).json({ error: 'A scan is already in progress for this repository' });
        if (result === 'not_found') return res.status(400).json({ error: 'Repository not found or missing URL' });
        if (result === 'forbidden') return res.status(403).json({ error: 'Access denied' });

        res.json({ scanId: result.scanId, message: 'Scan started' });
    } catch (err) {
        next(err);
    }
});

// Poll scan status — returns all fields the frontend needs
router.get('/scans/:scanId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { scanId } = req.params;
        const result = await repoService.getScanStatus(req.user!.$id, scanId);

        if (result === 'not_found') return res.status(404).json({ error: 'Scan not found' });
        if (result === 'forbidden') return res.status(403).json({ error: 'Access denied' });

        res.json(result.data);
    } catch (err) {
        next(err);
    }
});

export default router;
