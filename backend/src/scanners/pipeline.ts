import { assertScannersUsable, orchestrateScan } from '../services/scan/orchestrator';
import { cloneRepo } from '../utils/git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { logger } from '../services/logger';

export interface ScanPipelineResult {
  trivy: any;
  semgrep: any;
  gitleaks: any;
}

/**
 * The tools this result carries — and therefore the only ones the policy engine
 * can evaluate. Each must produce a verdict or the run is aborted.
 */
const REPORTED_TOOLS = ['trivy', 'semgrep', 'gitleaks'] as const;

export async function runScanPipeline(options: { owner?: string; repo?: string; branch?: string; cloneUrl?: string; localPath?: string; scanType?: 'full' | 'sast' | 'sca' | 'secrets' }): Promise<ScanPipelineResult> {
  const randomId = crypto.randomBytes(6).toString('hex');
  const tempDir = options.localPath || path.join(os.tmpdir(), `scorpion-ci-${options.owner}-${options.repo}-${randomId}`);

  try {
    // 1. Clone the repository branch (only if localPath is NOT provided)
    if (!options.localPath && options.cloneUrl && options.branch) {
      await cloneRepo({
        cloneUrl: options.cloneUrl,
        branch: options.branch,
        destination: tempDir
      });
    } else if (!options.localPath) {
      throw new Error('Either localPath or cloneUrl/branch must be provided');
    }

    // 2. Run the real scanners (Docker-based, same orchestrator scanService.ts uses
    // for the main repo-scan flow). This used to call local stub functions that
    // always returned `{}` - every call site silently got zero findings.
    logger.info(`[Pipeline] Starting multi-tool scan in ${tempDir}`);
    const results = await orchestrateScan(tempDir, { scanType: options.scanType || 'full' });
    const findResult = (tool: string) => results.find(r => r.tool === tool);

    // 3. Refuse to hand back a verdict built on a scanner that never ran.
    //
    // Only the three tools this result carries are required: the policy engine
    // evaluates these and nothing else, so a checkov or bandit failure cannot
    // corrupt the gate decision and must not fail the pipeline.
    //
    // Throwing is the fail-closed path at every call site — ciOrchestrator sets
    // the commit status to `error`, buildService aborts the build, repoService
    // logs and abandons the background scan.
    assertScannersUsable(results, REPORTED_TOOLS);

    // 4. Process results
    // We return the raw objects, the orchestrator/policy engine will handle the parsing logic
    return {
      trivy:    parseJsonSafe(findResult('trivy')?.stdout ?? '{}'),
      semgrep:  parseJsonSafe(findResult('semgrep')?.stdout ?? '{}'),
      gitleaks: parseJsonSafe(findResult('gitleaks')?.stdout ?? '[]')
    };

  } catch (error) {
    logger.error(`[Pipeline] Global failure for ${options.repo}:`, error);
    throw error;
  } finally {
    // 4. Always clean up (ONLY if it was a generated temp clone, NEVER a local IDE scan)
    const isGeneratedTemp = tempDir.includes('scorpion-ci-');
    if (!options.localPath && isGeneratedTemp) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`[Pipeline] Cleaned up temp workspace: ${tempDir}`);
      } catch (cleanupErr) {
        logger.error(`[Pipeline] Failed to clean up ${tempDir}:`, cleanupErr);
      }
    }
  }
}

function parseJsonSafe(stdout: string) {
  try {
    if (!stdout || !stdout.trim()) return {};
    return JSON.parse(stdout);
  } catch (e) {
    return { raw: stdout, parseError: true };
  }
}
