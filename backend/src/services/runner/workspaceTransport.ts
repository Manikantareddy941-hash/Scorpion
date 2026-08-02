import * as k8s from '@kubernetes/client-node';
import { TarArchive } from 'archiver';
import { PassThrough, Readable } from 'stream';
import { INIT_CONTAINER_NAME, RUNNER_NAMESPACE, SENTINEL_PATH, WORKSPACE_PATH } from './jobSpec';

/**
 * Streams a workspace into a waiting Job pod over the Kubernetes exec channel.
 *
 * The backend PUSHES; the runner never fetches. That is what keeps the runner's
 * egress at zero — there is no object store to reach, no git host, no endpoint
 * of ours to probe. A malicious build script finds no network at all.
 *
 * `pods/exec` looks like a heavy grant and is not an escalation here: the
 * backend already holds `create jobs`, so it can already run any image with any
 * command. Exec into a pod already constrained by the Job template's
 * securityContext adds nothing it could not do more directly.
 */

/**
 * Extraction and the sentinel in ONE shell, with `set -e`.
 *
 * They must not be separable. If tar fails on a truncated stream the sentinel
 * is never written, the init container times out, and the Job fails — rather
 * than the workload starting on a half-populated tree and reporting a scan of
 * whatever arrived.
 *
 * --no-same-owner / --no-same-permissions: the archive carries the backend's
 * uids and modes, which mean nothing in a pod running as 10001 and would only
 * produce files it cannot read.
 */
export const EXTRACT_COMMAND = [
  '/bin/sh', '-c',
  `set -e; tar -xzf - --no-same-owner --no-same-permissions -C ${WORKSPACE_PATH}; touch ${SENTINEL_PATH}`,
];

export class TransportError extends Error {}

/**
 * A gzipped tar of `workspacePath`.
 *
 * `dot: true` because a repository's .gitignore, .github and similar are part
 * of what the scanners read; omitting them would silently change results.
 */
export function archiveWorkspace(workspacePath: string): Readable {
  // archiver v8 exposes archive classes rather than the v7 factory function.
  const archive = new TarArchive({ gzip: true });
  const out = new PassThrough();
  archive.on('error', (err: Error) => out.destroy(err));
  archive.pipe(out);
  archive.directory(workspacePath, false, undefined);
  void archive.finalize();
  return out;
}

export interface ExecLike {
  exec(
    namespace: string, pod: string, container: string, command: string[],
    stdout: NodeJS.WritableStream | null, stderr: NodeJS.WritableStream | null,
    stdin: NodeJS.ReadableStream | null, tty: boolean,
    statusCallback?: (status: k8s.V1Status) => void,
  ): Promise<unknown>;
}

/**
 * Feeds the pod and resolves once the remote command reports success.
 *
 * Rejects on a non-Success status or a stream error. The caller must treat any
 * rejection as transport failure and re-dispatch a FRESH Job rather than
 * retrying into this one: a partial extraction has already touched the
 * workspace, and a second stream over it would mix two trees.
 */
export async function streamWorkspace(
  exec: ExecLike, podName: string, workspacePath: string,
): Promise<void> {
  const stderr = new PassThrough();
  const errorText: string[] = [];
  stderr.on('data', (c: Buffer) => errorText.push(c.toString()));

  await new Promise<void>((resolve, reject) => {
    const stdin = archiveWorkspace(workspacePath);
    stdin.on('error', (err: Error) => reject(new TransportError(`workspace archive failed: ${err.message}`)));

    exec.exec(
      RUNNER_NAMESPACE, podName, INIT_CONTAINER_NAME, EXTRACT_COMMAND,
      null, stderr, stdin, false,
      (status) => {
        // The remote command's own exit status. A tar that failed on a
        // truncated stream lands here, and the sentinel was never written.
        if (status.status === 'Success') resolve();
        else reject(new TransportError(`extraction failed: ${status.message ?? 'unknown'} ${errorText.join('').slice(0, 200)}`));
      },
    ).catch((err: Error) => reject(new TransportError(`exec channel failed: ${err.message}`)));
  });
}

/**
 * Waits for the init container to be running so exec has something to attach to.
 *
 * A pod is Pending while it schedules and pulls, and exec against it fails. The
 * wait is bounded well inside the init container's own timeout so the failure
 * is attributed here rather than surfacing as an unexplained init timeout.
 */
export async function awaitLoaderReady(
  core: { listNamespacedPod: (o: { namespace: string; labelSelector: string }) => Promise<k8s.V1PodList> },
  jobName: string,
  timeoutMs = 90_000,
  pollMs = 1000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const pods = await core.listNamespacedPod({ namespace: RUNNER_NAMESPACE, labelSelector: `job-name=${jobName}` });
    for (const pod of pods.items ?? []) {
      const name = pod.metadata?.name;
      const loader = (pod.status?.initContainerStatuses ?? []).find((c) => c.name === INIT_CONTAINER_NAME);
      if (name && loader?.state?.running) return name;
      // A loader that already terminated means it timed out waiting, or the
      // image could not be pulled. Feeding it now is pointless.
      if (loader?.state?.terminated) {
        throw new TransportError(`workspace loader exited before it could be fed (${loader.state.terminated.reason ?? 'unknown'})`);
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new TransportError(`workspace loader did not start within ${timeoutMs}ms`);
}
