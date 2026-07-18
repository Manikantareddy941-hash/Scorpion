import { execFile } from 'child_process';
import { logger } from '../logger';
import { BinaryRunner } from './binaryRunner';
import { DockerRunner } from './dockerRunner';
import type { RunnerMode, RunnerProvider } from './types';

export * from './types';
export { BinaryRunner } from './binaryRunner';
export { DockerRunner } from './dockerRunner';

/**
 * Runner selection.
 *
 * RUNNER_MODE=docker  — force containers (self-hosted with a daemon)
 * RUNNER_MODE=binary  — force host processes (free-tier hosting, no daemon)
 * RUNNER_MODE=auto    — probe for a daemon once at boot, fall back to binary (default)
 */

let cached: RunnerProvider | undefined;

async function dockerAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    // `docker version` (not `info`) is the cheap check that still requires a
    // reachable daemon — it exits non-zero when the socket is missing.
    execFile('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 5000 }, err => {
      resolve(!err);
    });
  });
}

function build(mode: RunnerMode): RunnerProvider {
  return mode === 'docker' ? new DockerRunner() : new BinaryRunner();
}

/** Resolves the provider once and caches it; safe to call per scan. */
export async function getRunner(): Promise<RunnerProvider> {
  if (cached) return cached;

  const configured = process.env.RUNNER_MODE;
  if (configured === 'docker' || configured === 'binary') {
    cached = build(configured);
    logger.info(`[Runner] mode=${configured} (configured)`);
    return cached;
  }

  const mode: RunnerMode = (await dockerAvailable()) ? 'docker' : 'binary';
  cached = build(mode);
  logger.info(
    mode === 'docker'
      ? '[Runner] mode=docker (daemon detected)'
      : '[Runner] mode=binary (no Docker daemon — ZAP and Falco are unavailable in this mode)'
  );
  return cached;
}

/** Test seam — drops the cached probe result. */
export function resetRunner(): void {
  cached = undefined;
}
