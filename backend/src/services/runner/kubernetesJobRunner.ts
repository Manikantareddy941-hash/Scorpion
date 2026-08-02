import * as k8s from '@kubernetes/client-node';
import { randomUUID } from 'crypto';
import { JobRequest, RUNNER_NAMESPACE, buildJob } from './jobSpec';
import { ExecLike, TransportError, awaitLoaderReady, streamWorkspace } from './workspaceTransport';

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
  /**
   * True when the workspace never reached the pod.
   *
   * Kept distinct from an ordinary failure so infrastructure trouble is never
   * reported as a scan verdict — an empty result from a Job that never received
   * its code looks exactly like a clean scan otherwise.
   */
  transportFailed?: boolean;
  /** Container stdout+stderr, best effort — a pod reaped early may yield none. */
  logs: string;
  /** True when the Job exceeded activeDeadlineSeconds. */
  timedOut: boolean;
}

const POLL_INTERVAL_MS = 2000;

/** How many polls to give Kubernetes to write the condition explaining a failure. */
const MAX_CONDITION_WAITS = 3;

/** Just the two methods this needs, so a test can supply a stub. */
export interface LoadableConfig {
  loadFromCluster(): void;
  loadFromDefault(): void;
}

/**
 * Chooses in-cluster credentials or a local kubeconfig.
 *
 * The obvious `try { loadFromCluster() } catch { loadFromDefault() }` is wrong:
 * loadFromCluster does NOT throw when the in-cluster environment variables are
 * absent. It builds a config with an undefined host and port, so the fallback
 * never fires and the first API call dies on
 * `https://undefined:undefined/apis/batch/v1/...`. Detect the environment
 * explicitly rather than relying on it to fail.
 */
export function loadKubeConfig(kc: LoadableConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (env.KUBERNETES_SERVICE_HOST) kc.loadFromCluster();
  else kc.loadFromDefault();
}

export class KubernetesJobRunner {
  private batch: k8s.BatchV1Api;
  private core: k8s.CoreV1Api;
  private exec?: ExecLike;

  constructor(batch?: k8s.BatchV1Api, core?: k8s.CoreV1Api, exec?: ExecLike) {
    if (batch && core) { this.batch = batch; this.core = core; this.exec = exec; return; }
    const kc = new k8s.KubeConfig();
    loadKubeConfig(kc);
    this.batch = batch ?? kc.makeApiClient(k8s.BatchV1Api);
    this.core = core ?? kc.makeApiClient(k8s.CoreV1Api);
    this.exec = exec ?? new k8s.Exec(kc);
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
      if (request.withWorkspace) {
        if (!request.workspacePath) throw new TransportError('withWorkspace requires a workspacePath');
        if (!this.exec) throw new TransportError('no exec client available to stream the workspace');
        // The pod must be up before exec has anything to attach to, and the
        // loader is blocking on a sentinel until it is fed.
        const podName = await awaitLoaderReady(this.core, name);
        logger.log(`[K8sRunner] Streaming workspace into ${podName}`);
        await streamWorkspace(this.exec, podName, request.workspacePath, request.extraFiles);
        logger.log('[K8sRunner] Workspace delivered; workload starting');
      }

      const outcome = await this.awaitCompletion(name, request.timeoutSeconds ?? 900, logger);
      outcome.logs = await this.collectLogs(name, logger);
      logger.log(`[K8sRunner] Job ${name} finished: exit=${outcome.exitCode} timedOut=${outcome.timedOut}`);
      return outcome;
    } catch (err) {
      if (err instanceof TransportError) {
        // Never reported as a scan verdict. A Job that never received its code
        // produces an empty result, which is indistinguishable from a clean
        // scan unless the caller is told the difference.
        logger.log(`[K8sRunner] Workspace transport failed: ${err.message}`);
        return { exitCode: 1, logs: '', timedOut: false, transportFailed: true };
      }
      throw err;
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
    let conditionWaits = 0;

    while (Date.now() < deadline) {
      // readNamespacedJobStatus hits the jobs/status SUBRESOURCE, which needs a
      // separate RBAC grant. The Job object already carries .status, so reading
      // the object keeps the Role to plain `get jobs`. Only a real cluster
      // surfaced this — a mock returns whatever status you tell it to.
      const job = await this.batch.readNamespacedJob({ name, namespace: RUNNER_NAMESPACE });
      const status = job.status ?? {};

      if ((status.succeeded ?? 0) > 0) return { exitCode: 0, logs: '', timedOut: false };

      if ((status.failed ?? 0) > 0) {
        const conditions = status.conditions ?? [];
        // The failed count and the condition explaining it are not written
        // atomically, so a first read can show the failure with no reason yet.
        // Deciding from that would report every deadline as an ordinary
        // failure, which is exactly the distinction this is meant to preserve.
        // Bounded, not indefinite: if the condition never arrives, decide with
        // what is known rather than holding an ordinary failure open for the
        // whole remaining budget.
        if (conditions.length === 0 && conditionWaits < MAX_CONDITION_WAITS) {
          conditionWaits += 1;
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        // Matched on reason alone, not on `type === 'Failed'`: Kubernetes sets
        // a FailureTarget condition carrying DeadlineExceeded before the
        // terminal Failed one, and requiring the type misses that window.
        const deadlineExceeded = conditions.some((c) => c.reason === 'DeadlineExceeded');
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
