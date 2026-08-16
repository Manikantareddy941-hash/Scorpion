import { execFile } from 'child_process';
import { logger } from '../logger';
import { BinaryRunner } from './binaryRunner';
import { DockerRunner } from './dockerRunner';
import type { RunnerMode, RunnerProvider } from './types';

export * from './types';
export { BinaryRunner } from './binaryRunner';
export { DockerRunner } from './dockerRunner';
// KubernetesRunner is deliberately NOT re-exported. It reaches
// @kubernetes/client-node and archiver, and a static export here would put both
// in the module graph of every consumer of getRunner — import it directly if
// you need the class.

/**
 * Runner selection.
 *
 * RUNNER_MODE=docker     — force containers (self-hosted with a daemon)
 * RUNNER_MODE=binary     — force host processes (free-tier hosting, no daemon)
 * RUNNER_MODE=kubernetes — force ephemeral Jobs (isolated, zero egress)
 * RUNNER_MODE=auto       — probe for a daemon once at boot, fall back to binary (default)
 *
 * Kubernetes is opt-in rather than part of the auto probe. Auto-selecting it
 * from the presence of in-cluster credentials would silently change how scans
 * execute the moment the backend is deployed to a cluster, and the RBAC,
 * namespace and NetworkPolicy it depends on are a deployment decision, not
 * something to infer.
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

async function build(mode: RunnerMode): Promise<RunnerProvider> {
  if (mode === 'kubernetes') {
    // Loaded only when selected. @kubernetes/client-node and archiver are both
    // ESM-only and unparseable under the CJS test transform, so a static import
    // fails every suite that transitively reaches getRunner — whether or not it
    // will ever dispatch a Job.
    const { KubernetesRunner } = await import('./kubernetesRunner');
    return new KubernetesRunner();
  }
  return mode === 'docker' ? new DockerRunner() : new BinaryRunner();
}

/** Resolves the provider once and caches it; safe to call per scan. */
export async function getRunner(): Promise<RunnerProvider> {
  if (cached) return cached;

  const configured = process.env.RUNNER_MODE;

  // Emitted on every path so the selected mode is a queryable field rather than
  // prose. Only `kubernetes` gives the isolated zero-egress execution the runner
  // namespace is built for, and it is reachable ONLY by setting RUNNER_MODE
  // explicitly — the probe below chooses between docker and binary and can never
  // land on it. Without this event that fallback is invisible: scans keep
  // succeeding, just outside isolation, and nothing turns red to say so.
  const announce = (mode: RunnerMode) => {
    logger.info(`[Runner] mode=${mode}`, {
      event: 'RUNNER_MODE_SELECTED',
      mode,
      configuredMode: configured ?? null,
      // True whenever the mode was not explicitly requested — an unset
      // RUNNER_MODE included, since that is precisely the drift worth alerting
      // on in an environment that is supposed to be isolated.
      isFallback: mode !== configured,
      isolated: mode === 'kubernetes',
      // Binary mode runs scanners as host processes, so the two that require a
      // container are simply absent. Recorded because a scan that silently skips
      // them still reports success.
      zapAvailable: mode !== 'binary',
      falcoAvailable: mode !== 'binary',
    });
  };

  if (configured === 'docker' || configured === 'binary' || configured === 'kubernetes') {
    cached = await build(configured);
    announce(configured);
    return cached;
  }

  const mode: RunnerMode = (await dockerAvailable()) ? 'docker' : 'binary';
  cached = await build(mode);
  announce(mode);
  return cached;
}

/** Test seam — drops the cached probe result. */
export function resetRunner(): void {
  cached = undefined;
}
