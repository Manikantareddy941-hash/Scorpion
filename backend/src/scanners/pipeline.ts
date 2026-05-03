import { runSemgrep, runGitleaks, runTrivy } from '../services/scan/orchestrator';
import { cloneRepo } from '../utils/git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface ScanPipelineResult {
  trivy: any;
  semgrep: any;
  gitleaks: any;
}

export async function runScanPipeline(options: { owner?: string; repo?: string; branch?: string; cloneUrl?: string; localPath?: string }): Promise<ScanPipelineResult> {
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

    // 2. Run all scanners in parallel
    console.log(`[Pipeline] Starting multi-tool scan in ${tempDir}`);
    const [trivyRes, semgrepRes, gitleaksRes] = await Promise.allSettled([
      runTrivy(tempDir),
      runSemgrep(tempDir),
      runGitleaks(tempDir)
    ]);

    // 3. Process results
    // We return the raw objects, the orchestrator/policy engine will handle the parsing logic
    return {
      trivy:    trivyRes.status    === 'fulfilled' ? parseJsonSafe(trivyRes.value.stdout) : { error: (trivyRes as any).reason },
      semgrep:  semgrepRes.status  === 'fulfilled' ? parseJsonSafe(semgrepRes.value.stdout) : { error: (semgrepRes as any).reason },
      gitleaks: gitleaksRes.status === 'fulfilled' ? parseJsonSafe(gitleaksRes.value.stdout) : { error: (gitleaksRes as any).reason }
    };

  } catch (error) {
    console.error(`[Pipeline] Global failure for ${options.repo}:`, error);
    throw error;
  } finally {
    // 4. Always clean up (ONLY if it was a generated temp clone, NEVER a local IDE scan)
    const isGeneratedTemp = tempDir.includes('scorpion-ci-');
    if (!options.localPath && isGeneratedTemp) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log(`[Pipeline] Cleaned up temp workspace: ${tempDir}`);
      } catch (cleanupErr) {
        console.error(`[Pipeline] Failed to clean up ${tempDir}:`, cleanupErr);
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
