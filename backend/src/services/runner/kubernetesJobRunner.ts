import * as k8s from '@kubernetes/client-node';
import { randomUUID } from 'crypto';
import { JobRequest, RUNNER_NAMESPACE, buildJob } from './jobSpec';

/**
 * Dispatches a workload as a Kubernetes Job and follows it to completion.
 *
 * The walking skeleton for the ephemeral runner: create, watch, collect output,
 * clean up. No workspace transport yet — that decision comes next, and it will
 * be shaped by what this turns out to be awkward about.
 *
 * Nothing calls this in production. dockerRunnerService is still the executor.
 */

export interface JobOutcome {
  /** 0 on success. 1 when the Job failed or hit its deadline. */
  exitCode: number;
  /** Container stdout+stderr, best effort — a pod reaped early may yield none. */
  logs: string;
  /** True when the Job exceeded activeDeadlineSeconds. */
  timedOut: boolean;
}

const POLL_INTERVAL_MS = 2000;

export class KubernetesJobRunner {
  private batch: k8s.BatchV1Api;
  private core: k8s.CoreV1Api;

  constructor(batch?: k8s.BatchV1Api, core?: k8s.CoreV1Api) {
    if (batch && core) { this.batch = batch; this.core = core; return; }
    const kc = new k8s.KubeConfig();
    try {
      kc.loadFromCluster();
    } catch {
      kc.loadFromDefault(); // local dev: ~/.kube/config
    }
    this.batch = batch ?? kc.makeApiClient(k8s.BatchV1Api);
    this.core = core ?? kc.makeApiClient(k8s.CoreV1Api);
  }

  /**
   * Runs `request` to completion.
   *
   * Polls rather than watches. A watch stream is more elegant and reconnects
   * badly: it drops silently on an API server restart, and a dispatcher that
   * stops hearing about a Job it created leaks pods. Polling every couple of
   * seconds is dull, self-healing, and adequate for work measured in minutes.
   *
   * The Job is deleted in a finally block, and also carries
   * ttlSecondsAfterFinished so a backend crash between start and cleanup still
   * gets reaped by the cluster rather than leaving an orphan.
   */
  async run(request: JobRequest, logger: { log: (m: string) => void }): Promise<JobOutcome> {
    const suffix = randomUUID().slice(0, 8);
    const job = buildJob(request, suffix);
    const name = job.metadata?.name as string;

    logger.log(`[K8sRunner] Dispatching Job ${name} in namespace ${RUNNER_NAMESPACE}`);
    await this.batch.createNamespacedJob({ namespace: RUNNER_NAMESPACE, body: job });

    try {
      const outcome = await this.awaitCompletion(name, request.timeoutSeconds ?? 900, logger);
      outcome.logs = await this.collectLogs(name, logger);
      logger.log(`[K8sRunner] Job ${name} finished: exit=${outcome.exitCode} timedOut=${outcome.timedOut}`);
      return outcome;
    } finally {
      await this.cleanup(name, logger);
    }
  }

  private async awaitCompletion(
    name: string, timeoutSeconds: number, logger: { log: (m: string) => void },
  ): Promise<JobOutcome> {
    // Outlives activeDeadlineSeconds so the cluster's own deadline wins and is
    // reported as a timeout, rather than this loop giving up first and calling
    // a still-running Job an error.
    const deadline = Date.now() + (timeoutSeconds + 60) * 1000;

    while (Date.now() < deadline) {
      const job = await this.batch.readNamespacedJobStatus({ name, namespace: RUNNER_NAMESPACE });
      const status = job.status ?? {};

      if ((status.succeeded ?? 0) > 0) return { exitCode: 0, logs: '', timedOut: false };

      if ((status.failed ?? 0) > 0) {
        // DeadlineExceeded is the cluster reporting our own activeDeadlineSeconds.
        const deadlineExceeded = (status.conditions ?? []).some(
          (c) => c.type === 'Failed' && c.reason === 'DeadlineExceeded',
        );
        return { exitCode: 1, logs: '', timedOut: deadlineExceeded };
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    logger.log(`[K8sRunner] Job ${name} did not report completion within the poll budget`);
    return { exitCode: 1, logs: '', timedOut: true };
  }

  /**
   * Best effort. A pod can be gone before logs are read — evicted, or reaped by
   * ttlSecondsAfterFinished on a slow path — and losing output must not turn a
   * successful scan into a failed one.
   */
  private async collectLogs(jobName: string, logger: { log: (m: string) => void }): Promise<string> {
    try {
      const pods = await this.core.listNamespacedPod({
        namespace: RUNNER_NAMESPACE,
        labelSelector: `job-name=${jobName}`,
      });
      const parts: string[] = [];
      for (const pod of pods.items ?? []) {
        const podName = pod.metadata?.name;
        if (!podName) continue;
        parts.push(await this.core.readNamespacedPodLog({ name: podName, namespace: RUNNER_NAMESPACE }));
      }
      return parts.join('\n');
    } catch (err) {
      logger.log(`[K8sRunner] Could not read logs for ${jobName}: ${(err as Error).message}`);
      return '';
    }
  }

  private async cleanup(name: string, logger: { log: (m: string) => void }): Promise<void> {
    try {
      // Background propagation so the Job's pods go with it rather than being
      // orphaned once the Job object disappears.
      await this.batch.deleteNamespacedJob({ name, namespace: RUNNER_NAMESPACE, propagationPolicy: 'Background' });
    } catch (err) {
      // ttlSecondsAfterFinished is the backstop, so a failed delete is noted
      // rather than raised over a workload that already ran.
      logger.log(`[K8sRunner] Cleanup of ${name} failed (TTL will reap it): ${(err as Error).message}`);
    }
  }
}
