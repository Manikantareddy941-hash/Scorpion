import { Request } from 'express';
import { repoRepository } from '../repositories/repoRepository';
import { enqueueScan } from '../queues/scanQueue';
import { resolveOwnershipScope, resolveCreationOwnership, canAccessResource, assertRepoAccess } from './tenancyService';
import { hasPermission } from '../middleware/iamMiddleware';
import { getProvider } from './repoProviders';
import { runScanPipeline } from '../scanners/pipeline';
import { cloneRepo } from '../utils/git';
import { cleanupWorkspace } from './ingestionService';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger';
import { ScanStatusResponse, TriggerScanInput } from '../types/repo.types';

export const repoService = {
  /** Creates a repo, or updates the existing one if it's already tracked within this tenant scope. */
  async syncRepo(req: Request, userId: string, url: string) {
    const name = url.split('/').pop();
    const ownership = await resolveCreationOwnership(req, userId);

    const existingRepos = await repoRepository.findByOwnershipAndUrl(
      ownership.team_id ? 'team_id' : 'user_id',
      ownership.team_id || userId,
      url
    );

    if (existingRepos.total > 0) {
      return repoRepository.updateRepo(existingRepos.documents[0].$id, {
        name,
        updated_at: new Date().toISOString()
      });
    }

    return repoRepository.createRepo({
      ...ownership,
      url,
      name,
      visibility: 'public',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  },

  /** Deletes a repository, cleaning up its on-disk workspace if it was a ZIP upload. */
  async deleteRepo(req: Request, userId: string, repoId: string): Promise<'forbidden' | 'scan_in_progress' | { ok: true }> {
    const repo = await assertRepoAccess(repoId, userId);

    if (!(await hasPermission(req, userId, 'repo:delete', repoId))) {
      return 'forbidden';
    }

    const activeScans = await repoRepository.findActiveScan(repoId);
    if (activeScans.total > 0) {
      return 'scan_in_progress';
    }

    await repoRepository.deleteRepo(repoId);

    // Uploaded ZIP repos persist their extraction directory as local_path
    // (see ingestZip in ingestionService.ts) - nothing else ever cleans it up.
    if (typeof repo.local_path === 'string') {
      cleanupWorkspace(repo.local_path);
    }

    return { ok: true };
  },

  async listRepos(req: Request, userId: string) {
    const scope = await resolveOwnershipScope(req, userId);
    const ownedRepos = await repoRepository.listByScope(scope.field, scope.value);
    return ownedRepos.documents;
  },

  async listExternalRepos(provider: string, token: string) {
    const p = getProvider(provider);
    return p.listRepos(token);
  },

  /**
   * Clones and scans an external-provider repo in the background; the caller
   * gets an immediate 202 while the clone/scan/cleanup happens asynchronously.
   */
  triggerExternalScan(provider: string, repoFullName: string, cloneUrl: string, branch: string, token: string): string {
    const p = getProvider(provider);
    const authenticatedUrl = p.cloneUrl({ cloneUrl, fullName: repoFullName } as Parameters<typeof p.cloneUrl>[0], token);
    const workDir = path.join(process.cwd(), 'tmp', 'scorpion-scans', randomBytes(6).toString('hex'));

    (async () => {
      try {
        await fs.mkdir(path.dirname(workDir), { recursive: true });
        await cloneRepo({ cloneUrl: authenticatedUrl, branch, destination: workDir });

        logger.info(`[RepoService] Starting scan for ${repoFullName} at ${workDir}`);
        await runScanPipeline({ localPath: workDir });
      } catch (err) {
        logger.error(`[RepoService] External scan failed for ${repoFullName}:`, err instanceof Error ? err.message : err);
      } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    })();

    return workDir.split(/[\\/]/).pop() || '';
  },

  /** Creates a scan record and fires off the (queued) scan; does not await the scan itself. */
  async triggerScan(userId: string, repoId: string, options: TriggerScanInput): Promise<'scan_in_progress' | 'not_found' | 'forbidden' | { scanId: string }> {
    // Authorize before probing scan state. Checking findActiveScan first let a
    // caller distinguish 'scan_in_progress' from 'forbidden' on a repo they do
    // not own, which leaks both the repo's existence and whether it is being
    // scanned right now.
    const repo = await repoRepository.getRepo(repoId);
    if (!repo || !repo.url) return 'not_found';
    if (!(await canAccessResource(repo, userId))) return 'forbidden';

    const activeScans = await repoRepository.findActiveScan(repoId);
    if (activeScans.total > 0) return 'scan_in_progress';

    const scanStartedAt = new Date().toISOString();
    const scan = await repoRepository.createScan({
      repo_id: repoId,
      status: 'pending',
      scan_type: options.scanType || 'full',
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
        branch: options.branch || 'main',
        depth: options.scanDepth || 'standard'
      })
    });

    const scanId = scan.$id;

    // Fire and forget — do NOT await
    enqueueScan(repoId, options, scanId).catch(err => {
      logger.error(`[RepoService] Failed to enqueue scan for scanId=${scanId}:`, err instanceof Error ? err.message : err);
    });

    return { scanId };
  },

  async getScanStatus(userId: string, scanId: string): Promise<'not_found' | 'forbidden' | { ok: true; data: ScanStatusResponse }> {
    const scan = await repoRepository.getScan(scanId);
    if (!scan) return 'not_found';

    const repo = await repoRepository.getRepo(scan.repo_id);
    if (!repo || !(await canAccessResource(repo, userId))) return 'forbidden';

    let details: Record<string, unknown> = {};
    try {
      details = typeof scan.details === 'string' ? JSON.parse(scan.details) : (scan.details || {});
    } catch { /* malformed/missing details, fall back to defaults below */ }

    return {
      ok: true,
      data: {
        id: scan.$id,
        status: scan.status,
        // Top-level counts (set when scan completes)
        critical: scan.criticalCount || (details.critical_count as number) || 0,
        high: scan.highCount || (details.high_count as number) || 0,
        medium: scan.mediumCount || (details.medium_count as number) || 0,
        low: scan.lowCount || (details.low_count as number) || 0,
        // Score and gate
        security_score: (details.security_score as number) ?? 0,
        gateStatus: (details.gate_status as string) ?? 'pending',
        // Extra detail
        total_vulnerabilities: (details.total_vulnerabilities as number) || 0,
        tool_counts: (details.tool_counts as Record<string, number>) || {},
        language: (details.language as string) || 'Unknown',
        total_files: (details.total_files as number) || 0,
        total_lines: (details.total_lines as number) || 0,
        started_at: (details.started_at as string) || scan.$createdAt,
        completed_at: (details.completed_at as string) || null,
        error: (details.error as string) || null,
        logs: scan.logs || []
      }
    };
  }
};
