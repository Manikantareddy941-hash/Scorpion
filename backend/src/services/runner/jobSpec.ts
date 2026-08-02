import type { V1Container, V1Job } from '@kubernetes/client-node';

/**
 * Builds the Kubernetes Job that runs one workload.
 *
 * The isolation posture from the Docker runner does NOT carry over — CapDrop,
 * NetworkMode and PidsLimit are Docker HostConfig fields with no meaning here.
 * Every one of them has to be restated in Kubernetes terms, and this is where
 * that translation lives:
 *
 *   NetworkMode: 'none'   -> a default-deny egress NetworkPolicy selecting
 *                            app.kubernetes.io/component: runner (step 4; the
 *                            allowlist depends on the workspace transport)
 *   CapDrop / no-new-priv -> securityContext below, copied from the backend
 *                            Deployment which already got this right
 *   Memory / PidsLimit    -> resources.limits
 *   wall-clock kill       -> activeDeadlineSeconds
 *
 * Pure, so the posture is asserted in unit tests rather than discovered in a
 * cluster.
 */

export const RUNNER_NAMESPACE = process.env.RUNNER_NAMESPACE || 'scorpion';
export const RUNNER_SERVICE_ACCOUNT = 'scorpion-runner';

/** Where the workspace is mounted in both the init and workload containers. */
export const WORKSPACE_PATH = '/workspace';

/** Written by the transport only after a clean extraction. */
export const SENTINEL_PATH = WORKSPACE_PATH + '/.ready';

/** Named so the transport can exec into the right container. */
export const INIT_CONTAINER_NAME = 'workspace-loader';

/**
 * GNU tar, deliberately. BusyBox tar does not reliably refuse '..' and absolute
 * paths on extraction, and the tarball is built from a repository we did not
 * write — a crafted entry could otherwise escape the workspace mount.
 */
export const INIT_IMAGE = process.env.RUNNER_INIT_IMAGE || 'debian:12-slim';

/** How long the init container waits to be fed before giving up. */
export const TRANSPORT_WAIT_SECONDS = 120;

/** Marks pods the egress NetworkPolicy will select. */
export const RUNNER_LABELS = {
  'app.kubernetes.io/name': 'scorpion-backend',
  'app.kubernetes.io/component': 'runner',
};

export interface JobRequest {
  /** Becomes part of the Job name, so it must be DNS-safe. */
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  /** Wall-clock ceiling. The Job is failed and its pod killed past this. */
  timeoutSeconds?: number;
  memoryLimit?: string;
  cpuLimit?: string;
  /** Mounts a workspace volume and an init container that waits to be fed. */
  withWorkspace?: boolean;
  /** Ceiling on the extracted tree. Disk-backed, so it does not eat the memory limit. */
  workspaceLimit?: string;
  /** Host directory streamed into the pod. Required when withWorkspace is set. */
  workspacePath?: string;
}

const DEFAULTS = {
  timeoutSeconds: 900,
  memoryLimit: '2Gi',
  cpuLimit: '2',
  workspaceLimit: '2Gi',
};

/**
 * Kubernetes names are DNS-1123 labels: lowercase alphanumerics and dashes,
 * 63 characters. A caller-supplied name reaches the API server, so it is
 * normalised here rather than trusted.
 */
export function sanitizeName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  return (cleaned || 'job').slice(0, 40);
}

/**
 * The container the backend streams the workspace into.
 *
 * It blocks on a sentinel file rather than accepting the tarball itself,
 * because the two events must not be separable: the transport writes the
 * sentinel in the same shell as the extraction, and only on a clean tar exit.
 * A truncated stream therefore leaves no sentinel, this container times out,
 * and the Job fails — instead of the workload starting on a half-populated tree
 * and reporting a scan of whatever happened to arrive.
 *
 * The wait is bounded so a transport that never starts fails in two minutes
 * rather than consuming the Job's whole deadline.
 */
function workspaceLoader(): V1Container {
  return {
    name: INIT_CONTAINER_NAME,
    image: INIT_IMAGE,
    command: ['/bin/sh', '-c'],
    args: [`timeout ${TRANSPORT_WAIT_SECONDS} sh -c 'while [ ! -f ${SENTINEL_PATH} ]; do sleep 1; done'`],
    securityContext: {
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
      runAsUser: 10001,
      capabilities: { drop: ['ALL'] },
      seccompProfile: { type: 'RuntimeDefault' },
    },
    resources: {
      requests: { memory: '128Mi', cpu: '100m' },
      limits: { memory: '128Mi', cpu: '100m' },
    },
    volumeMounts: [
      { name: 'workspace', mountPath: WORKSPACE_PATH },
      { name: 'tmp', mountPath: '/tmp' },
    ],
  };
}

export function buildJob(request: JobRequest, suffix: string): V1Job {
  const timeout = request.timeoutSeconds ?? DEFAULTS.timeoutSeconds;

  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: `${sanitizeName(request.name)}-${suffix}`,
      namespace: RUNNER_NAMESPACE,
      labels: RUNNER_LABELS,
    },
    spec: {
      // A scan that failed is a result, not something to retry blindly: a
      // retried malicious payload just runs twice.
      backoffLimit: 0,
      activeDeadlineSeconds: timeout,
      // Reaped automatically even if the backend crashes before cleanup, so a
      // restart cannot leave orphaned pods holding resources.
      ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: RUNNER_LABELS },
        spec: {
          restartPolicy: 'Never',
          // No API token: the workload executes hostile code and has no
          // business reaching the Kubernetes API, even read-only.
          serviceAccountName: RUNNER_SERVICE_ACCOUNT,
          automountServiceAccountToken: false,
          // Copied from the backend Deployment, which already expresses the
          // posture PR #175 established for Docker.
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 10001,
            fsGroup: 10001,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          containers: [
            {
              name: 'workload',
              image: request.image,
              ...(request.command ? { command: request.command } : {}),
              ...(request.args ? { args: request.args } : {}),
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                runAsNonRoot: true,
                runAsUser: 10001,
                capabilities: { drop: ['ALL'] },
                seccompProfile: { type: 'RuntimeDefault' },
              },
              resources: {
                // Requests equal limits: the workload gets a guaranteed QoS
                // slice and cannot burst into what the control plane needs.
                requests: { memory: request.memoryLimit ?? DEFAULTS.memoryLimit, cpu: request.cpuLimit ?? DEFAULTS.cpuLimit },
                limits: { memory: request.memoryLimit ?? DEFAULTS.memoryLimit, cpu: request.cpuLimit ?? DEFAULTS.cpuLimit },
              },
              // readOnlyRootFilesystem still needs somewhere to write.
              volumeMounts: [
                { name: 'tmp', mountPath: '/tmp' },
                ...(request.withWorkspace ? [{ name: 'workspace', mountPath: WORKSPACE_PATH }] : []),
              ],
            },
          ],

          ...(request.withWorkspace ? { initContainers: [workspaceLoader()] } : {}),

          volumes: [
            { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '256Mi' } },
            ...(request.withWorkspace
              // No `medium` — disk-backed on purpose. A memory-backed volume
              // counts against the container's memory limit, so a repository of
              // any size would OOM the pod rather than fill a disk.
              ? [{ name: 'workspace', emptyDir: { sizeLimit: request.workspaceLimit ?? DEFAULTS.workspaceLimit } }]
              : []),
          ],
        },
      },
    },
  };
}
