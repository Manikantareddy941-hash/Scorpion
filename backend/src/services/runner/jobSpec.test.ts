import { RUNNER_NAMESPACE, buildJob, sanitizeName } from './jobSpec';

const req = { name: 'trivy-scan', image: 'alpine:3.20' };
const spec = (over = {}) => buildJob({ ...req, ...over }, 'abcd1234');
const pod = (over = {}) => spec(over).spec!.template.spec!;
const container = (over = {}) => pod(over).containers[0];

describe('the isolation posture is restated, not inherited', () => {
  // CapDrop, NetworkMode and PidsLimit are Docker HostConfig fields with no
  // meaning in Kubernetes. A Job built without these is a runner with none of
  // the protections PR #175 added.
  test('capabilities are dropped and escalation is blocked', () => {
    const sc = container().securityContext!;

    expect(sc.capabilities?.drop).toEqual(['ALL']);
    expect(sc.allowPrivilegeEscalation).toBe(false);
  });

  test('runs unprivileged with the seccomp profile the Deployment uses', () => {
    expect(pod().securityContext).toMatchObject({
      runAsNonRoot: true, runAsUser: 10001, fsGroup: 10001,
      seccompProfile: { type: 'RuntimeDefault' },
    });
    expect(container().securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 10001 });
  });

  test('the root filesystem is read-only, with a bounded in-memory scratch space', () => {
    expect(container().securityContext?.readOnlyRootFilesystem).toBe(true);
    // readOnlyRootFilesystem still needs somewhere to write, and an unbounded
    // emptyDir on a memory medium is a node-level memory bomb.
    expect(pod().volumes).toEqual([{ name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '256Mi' } }]);
    expect(container().volumeMounts).toEqual([{ name: 'tmp', mountPath: '/tmp' }]);
  });

  test('memory and CPU are capped, with requests equal to limits', () => {
    // Guaranteed QoS: the workload cannot burst into what the control plane needs.
    const res = container().resources!;
    expect(res.limits).toEqual({ memory: '2Gi', cpu: '2' });
    expect(res.requests).toEqual(res.limits);
  });

  test('the wall-clock ceiling is the cluster deadline', () => {
    expect(spec().spec!.activeDeadlineSeconds).toBe(900);
    expect(spec({ timeoutSeconds: 60 }).spec!.activeDeadlineSeconds).toBe(60);
  });
});

describe('the workload cannot reach the control plane', () => {
  test('no API token is mounted', () => {
    // A scan executes hostile code. It has no business reaching the Kubernetes
    // API at all, even read-only.
    expect(pod().automountServiceAccountToken).toBe(false);
  });

  test('it runs under the runner ServiceAccount, which has no Role bound', () => {
    expect(pod().serviceAccountName).toBe('scorpion-runner');
  });
});

describe('lifecycle', () => {
  test('a failed workload is not retried', () => {
    // Retrying a malicious payload just runs it twice; a failed scan is a
    // result, not a transient error.
    expect(spec().spec!.backoffLimit).toBe(0);
  });

  test('the pod never restarts in place', () => {
    expect(pod().restartPolicy).toBe('Never');
  });

  test('finished Jobs are reaped even if the backend never cleans up', () => {
    // The dispatcher deletes the Job in a finally block, but a crash between
    // start and cleanup would otherwise orphan pods holding resources.
    expect(spec().spec!.ttlSecondsAfterFinished).toBe(300);
  });
});

describe('naming', () => {
  test('is labelled so the egress NetworkPolicy can select it', () => {
    // Step 4 scopes default-deny egress to this label rather than the whole
    // namespace, which would cut the backend off from Appwrite.
    // The label must be on the POD template, not only the Job: a NetworkPolicy
    // selects pods, so labelling the Job alone would leave the policy inert.
    expect(spec().metadata!.labels).toMatchObject({ 'app.kubernetes.io/component': 'runner' });
    expect(spec().spec!.template.metadata!.labels).toMatchObject({ 'app.kubernetes.io/component': 'runner' });
  });

  test('lands in the runner namespace', () => {
    expect(spec().metadata!.namespace).toBe(RUNNER_NAMESPACE);
  });

  test('a caller-supplied name is normalised before it reaches the API server', () => {
    expect(sanitizeName('Trivy Scan: repo/name@v1')).toBe('trivy-scan--repo-name-v1');
    expect(sanitizeName('---')).toBe('job');
    expect(sanitizeName('')).toBe('job');
  });

  test('a long name is truncated to stay within the DNS label limit', () => {
    const built = buildJob({ ...req, name: 'x'.repeat(200) }, 'abcd1234');
    expect(built.metadata!.name!.length).toBeLessThanOrEqual(63);
  });

  test('the suffix keeps concurrent Jobs for the same workload apart', () => {
    expect(buildJob(req, 'aaaa').metadata!.name).not.toBe(buildJob(req, 'bbbb').metadata!.name);
  });
});
