import { Router, Response, Request, NextFunction } from 'express';
import { z } from 'zod';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { enqueueScan } from '../queues/scanQueue';
import { resolveOwnershipScope, resolveCreationOwnership, canAccessResource, TenantAccessError } from '../services/tenancyService';
import { getProvider } from '../services/repoProviders';
import { runScanPipeline } from '../scanners/pipeline';
import { cloneRepo } from '../utils/git';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { validateBody } from '../middleware/validate';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

const addRepoSchema = z.object({
    url: z.string().trim().url('url must be a valid URL'),
});

const externalScanSchema = z.object({
    provider: z.string().trim().min(1),
    repoFullName: z.string().trim().min(1),
    cloneUrl: z.string().trim().url('cloneUrl must be a valid URL'),
    branch: z.string().trim().min(1).max(255).optional(),
});

const triggerScanSchema = z.object({
    scanType: z.enum(['full', 'incremental', 'quick']).optional(),
    scanDepth: z.enum(['standard', 'deep']).optional(),
    branch: z.string().trim().min(1).max(255).optional(),
});

// Add/Sync repository
router.post('/', validateBody(addRepoSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { url } = req.body;

    try {
        const userId = req.user!.$id;
        const name = url.split('/').pop();
        const ownership = await resolveCreationOwnership(req, userId);

        // Check if repo already exists within this tenant scope (team if active, else personal)
        const existingRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal(ownership.team_id ? 'team_id' : 'user_id', ownership.team_id || userId),
            Query.equal('url', url),
            Query.limit(1)
        ]);

        if (existingRepos.total > 0) {
            const data = await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, existingRepos.documents[0].$id, {
                name,
                updated_at: new Date().toISOString()
            });
            return res.json(data);
        }

        const data = await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), {
            ...ownership,
            url,
            name,
            visibility: 'public',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        res.json(data);
    } catch (error: unknown) {
        if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
        next(error);
    }
});

// List repos
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id;
        const scope = await resolveOwnershipScope(req, userId);

        const ownedRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal(scope.field, scope.value),
            Query.orderDesc('updated_at')
        ]);

        res.json(ownedRepos.documents);
    } catch (error: unknown) {
        if (error instanceof TenantAccessError) return res.status(403).json({ error: error.message });
        next(error);
    }
});

// List repos from any provider (GitLab, Bitbucket, Azure)
router.get('/external', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const provider = req.query.provider as string;
    const token = req.headers['x-provider-token'] as string;
    
    if (!provider || !token) return res.status(400).json({ error: 'Provider and x-provider-token header are required' });
    
    try {
        const p = getProvider(provider);
        const repos = await p.listRepos(token);
        res.json({ repos });
    } catch (error: any) {
        logger.error(`[RepoRoutes] Failed to list ${provider} repos:`, error.message);
        res.status(500).json({ error: `Failed to list ${provider} repositories` });
    }
});

// Trigger scan on any provider repo (Directly)
router.post('/external/scan', validateBody(externalScanSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { provider, repoFullName, cloneUrl, branch = 'main' } = req.body;
    const token = req.headers['x-provider-token'] as string;

    if (!token) {
        return res.status(400).json({ error: 'x-provider-token header is required' });
    }

    try {
        const p = getProvider(provider);
        const authenticatedUrl = p.cloneUrl({ cloneUrl, fullName: repoFullName } as any, token);
        const workDir = path.join(process.cwd(), 'tmp', 'scorpion-scans', randomBytes(6).toString('hex'));

        // Respond immediately (Accepted)
        res.status(202).json({ message: 'Scan triggered', workDir: workDir.split(/[\\/]/).pop() });

        // Background execution
        (async () => {
            try {
                await fs.mkdir(path.dirname(workDir), { recursive: true });
                await cloneRepo({ cloneUrl: authenticatedUrl, branch, destination: workDir });
                
                logger.info(`[RepoRoutes] Starting scan for ${repoFullName} at ${workDir}`);
                await runScanPipeline({ localPath: workDir,  });
                
            } catch (err: any) {
                logger.error(`[RepoRoutes] External scan failed for ${repoFullName}:`, err.message);
            } finally {
                await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
            }
        })();

    } catch (error: any) {
        next(error);
    }
});

// Trigger scan — fire and forget (respond immediately, scan runs in background)
router.post('/:id/scan', validateBody(triggerScanSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { scanType, scanDepth, branch } = req.body;

        // Check for active scan first
        const activeScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoId),
            Query.equal('status', ['pending', 'running']),
            Query.limit(1)
        ]);
        if (activeScans.total > 0) {
            return res.status(409).json({ error: 'A scan is already in progress for this repository' });
        }

        // Create the scan record immediately so we have a scanId to return
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
        if (!repo || !repo.url) return res.status(400).json({ error: 'Repository not found or missing URL' });
        if (!(await canAccessResource(repo, req.user!.$id))) return res.status(403).json({ error: 'Access denied' });

        const scanStartedAt = new Date().toISOString();
        const scan = await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
            repo_id: repoId,
            status: 'pending',
            scan_type: scanType || 'full',
            repoUrl: repo.url,
            startedAt: scanStartedAt,
            timestamp: scanStartedAt,
            scannerVersion: '1.0.0',
            visibility: 'public',
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            details: JSON.stringify({
                started_at: scanStartedAt,
                target: repo.url,
                branch: branch || 'main',
                depth: scanDepth || 'standard'
            })
        });

        const scanId = scan.$id;

        // 🔥 Fire and forget — do NOT await
        enqueueScan(repoId, { scanType, scanDepth, branch }, scanId).catch(err => {
            logger.error(`[RepoRoutes] Failed to enqueue scan for scanId=${scanId}:`, err.message);
        });

        // Respond immediately with scanId
        res.json({ scanId, message: 'Scan started' });

    } catch (err) {
        next(err);
    }
});

// Poll scan status — returns all fields the frontend needs
router.get('/scans/:scanId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { scanId } = req.params;
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        if (!scan) return res.status(404).json({ error: 'Scan not found' });

        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, scan.repo_id);
        if (!repo || !(await canAccessResource(repo, req.user!.$id))) return res.status(403).json({ error: 'Access denied' });

        // Parse details JSON
        let details: any = {};
        try {
            details = typeof scan.details === 'string' ? JSON.parse(scan.details) : (scan.details || {});
        } catch {}

        res.json({
            id: scan.$id,
            status: scan.status,
            // Top-level counts (set when scan completes)
            critical: scan.criticalCount || details.critical_count || 0,
            high:     scan.highCount     || details.high_count     || 0,
            medium:   scan.mediumCount   || details.medium_count   || 0,
            low:      scan.lowCount      || details.low_count      || 0,
            // Score and gate
            security_score: details.security_score ?? 0,
            gateStatus:     details.gate_status    ?? 'pending',
            // Extra detail
            total_vulnerabilities: details.total_vulnerabilities || 0,
            tool_counts:   details.tool_counts   || {},
            language:      details.language      || 'Unknown',
            total_files:   details.total_files   || 0,
            total_lines:   details.total_lines   || 0,
            started_at:    details.started_at    || scan.$createdAt,
            completed_at:  details.completed_at  || null,
            error:         details.error         || null,
            logs:          scan.logs             || [],
        });
    } catch (err) {
        next(err);
    }
});

export default router;
