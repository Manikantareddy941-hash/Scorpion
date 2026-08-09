import { Router, Response, NextFunction } from 'express';
import { TenantAccessError } from '../services/tenancyService';
import { repoService } from '../services/repoService';
import { validateBody } from '../middleware/validate';
import { scanTriggerLimiter } from '../middleware/rateLimiters';
import { logger, errorContext } from '../services/logger';
import { AuthenticatedRequest, addRepoSchema, bulkConnectSchema, externalScanSchema, triggerScanSchema } from '../types/repo.types';
import { getEffectivePolicy } from '../services/policyService';
import { hasRequiredRole } from '../services/rbacService';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';

const router = Router();

const POLICY_PRESETS: Record<string, { max_critical: number; max_high: number; min_risk_score: number }> = {
    strict: { max_critical: 0, max_high: 0, min_risk_score: 80 },
    balanced: { max_critical: 0, max_high: 5, min_risk_score: 50 },
    relaxed: { max_critical: 2, max_high: 15, min_risk_score: 30 }
};

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

// List every repo visible to the installed GitHub App (org-wide onboarding)
router.get('/github/installations', async (_req: AuthenticatedRequest, res: Response) => {
    try {
        // Lazy import: octokit is ESM-only and breaks jest's CJS parse of this
        // module in every test that mounts repoRoutes. Loading it per-request
        // keeps the route module octokit-free.
        const { listInstallationRepos } = await import('../github/appInstallations');
        res.json({ repos: await listInstallationRepos() });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[RepoRoutes] Failed to list GitHub App installation repos:', {
            event: 'REPO_APP_INSTALLATION_LIST_FAILED', ...errorContext(error),
        });
        const status = message.includes('not configured') ? 503 : 502;
        res.status(status).json({ error: 'Failed to list GitHub App installation repositories' });
    }
});

// Bulk-connect repositories discovered via the GitHub App installation
router.post('/bulk-connect', validateBody(bulkConnectSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { urls } = req.body as { urls: string[] };

    try {
        const userId = req.user!.$id;
        const connected: string[] = [];
        const failed: string[] = [];

        for (const url of urls) {
            try {
                await repoService.syncRepo(req, userId, url);
                connected.push(url);
            } catch (error: unknown) {
                if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
                failed.push(url);
                logger.warn(`[RepoRoutes] Bulk-connect failed for ${url}`, errorContext(error));
            }
        }

        res.json({ connected: connected.length, failed });
    } catch (error: unknown) {
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
        logger.error(`[RepoRoutes] Failed to list ${provider} repos`, errorContext(error));
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
// List scans across every repo the caller can reach. `repoId` narrows to one.
// Registered before '/:id' so the literal path is not swallowed by the param.
router.get('/scans', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { repoId, status } = req.query;
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const result = await repoService.listScans(req, req.user!.$id, {
            repoId: repoId as string | undefined,
            status: status as string | undefined,
            limit,
        });

        if (result === 'not_found') return res.status(404).json({ error: 'Repository not found' });
        res.json({ total: result.documents.length, documents: result.documents });
    } catch (error: unknown) {
        if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
        next(error);
    }
});

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

// Get the effective governance policy for a repo
router.get('/:id/policy', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        if (!(await hasRequiredRole(req.user!.$id, repoId, 'viewer'))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        res.json(await getEffectivePolicy(repoId));
    } catch (err) {
        next(err);
    }
});

// Switch a repo's governance policy preset (Strict / Balanced / Relaxed)
router.put('/:id/policy', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { policy_name } = req.body;
        if (!Object.prototype.hasOwnProperty.call(POLICY_PRESETS, policy_name)) {
            return res.status(400).json({ error: 'Unknown policy_name' });
        }
        const preset = POLICY_PRESETS[policy_name];

        if (!(await hasRequiredRole(req.user!.$id, repoId, 'admin'))) {
            return res.status(403).json({ error: 'Only repo admins can change the governance policy' });
        }

        const existing = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_POLICIES, [
            Query.equal('repo_id', repoId),
            Query.limit(1)
        ]);

        const data = { repo_id: repoId, policy_name, ...preset };
        if (existing.total > 0) {
            await databases.updateDocument(DB_ID, COLLECTIONS.PROJECT_POLICIES, existing.documents[0].$id, data);
        } else {
            await databases.createDocument(DB_ID, COLLECTIONS.PROJECT_POLICIES, ID.unique(), data);
        }

        res.json(await getEffectivePolicy(repoId));
    } catch (err) {
        next(err);
    }
});

// List teams granted access to a repo
router.get('/:id/access', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        if (!(await hasRequiredRole(req.user!.$id, repoId, 'viewer'))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const accessDocs = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_ACCESS, [
            Query.equal('repo_id', repoId)
        ]);

        const enriched = await Promise.all(accessDocs.documents.map(async (doc) => {
            const team = await databases.getDocument(DB_ID, COLLECTIONS.TEAMS, doc.team_id).catch(() => null);
            return { id: doc.$id, team_id: doc.team_id, teams: team ? { name: team.name } : null };
        }));

        res.json(enriched);
    } catch (err) {
        next(err);
    }
});

// Grant or revoke a team's access to a repo
router.put('/:id/access', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { team_id, action } = req.body;
        if (!team_id || !['grant', 'revoke'].includes(action)) {
            return res.status(400).json({ error: 'team_id and action ("grant" | "revoke") are required' });
        }

        if (!(await hasRequiredRole(req.user!.$id, repoId, 'admin'))) {
            return res.status(403).json({ error: 'Only repo admins can change access' });
        }

        const existing = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_ACCESS, [
            Query.equal('repo_id', repoId),
            Query.equal('team_id', team_id),
            Query.limit(1)
        ]);

        if (action === 'revoke') {
            if (existing.total > 0) {
                await databases.deleteDocument(DB_ID, COLLECTIONS.PROJECT_ACCESS, existing.documents[0].$id);
            }
        } else if (existing.total === 0) {
            await databases.createDocument(DB_ID, COLLECTIONS.PROJECT_ACCESS, ID.unique(), { repo_id: repoId, team_id });
        }

        res.json({ message: action === 'revoke' ? 'Access revoked' : 'Access granted' });
    } catch (err) {
        next(err);
    }
});

// Scheduled-scan settings for a repo.
router.patch('/:id/schedule', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { cron_enabled, cron_schedule } = req.body;
        if (typeof cron_enabled !== 'boolean') {
            return res.status(400).json({ error: 'cron_enabled must be a boolean' });
        }

        const result = await repoService.setScanSchedule(req.user!.$id, req.params.id, {
            cron_enabled,
            cron_schedule,
        });

        if (result === 'not_found') return res.status(404).json({ error: 'Repository not found' });
        if (result === 'invalid_schedule') return res.status(400).json({ error: 'cron_schedule is not a valid cron expression' });
        if (result === 'too_frequent') {
            return res.status(400).json({ error: 'Scheduled scans may run at most once per hour' });
        }

        res.json(result.repo);
    } catch (error: unknown) {
        if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
        next(error);
    }
});

// Single repo. Declared LAST: '/:id' matches one segment, so it would otherwise
// shadow '/external', '/scans', and every other literal single-segment route.
router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repo = await repoService.getRepoById(req.user!.$id, req.params.id);
        if (repo === 'not_found') return res.status(404).json({ error: 'Repository not found' });
        res.json(repo);
    } catch (error: unknown) {
        if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
        next(error);
    }
});

export default router;
