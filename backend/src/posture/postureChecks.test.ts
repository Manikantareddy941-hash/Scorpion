import { runPostureChecks, scoreNamespace, ClusterSnapshot, PodPosture, PostureContainer } from './postureChecks';

const container = (over: Partial<PostureContainer> = {}): PostureContainer => ({
  name: 'app', image: 'reg/app:1.2.3', privileged: false, runAsNonRoot: true,
  hasCpuLimit: true, hasMemoryLimit: true, envVars: [], ...over,
});

const pod = (over: Partial<PodPosture> = {}): PodPosture => ({
  namespace: 'prod', podName: 'web-1', serviceAccountName: 'web-sa',
  automountServiceAccountToken: false, hostPathVolumes: [], containers: [container()],
  ...over,
});

const snapshot = (pods: PodPosture[], nsOver: Partial<ClusterSnapshot['namespaces'][number]> = {}): ClusterSnapshot => ({
  pods,
  namespaces: [{ name: 'prod', podCount: pods.length, networkPolicyCount: 1, ...nsOver }],
});

const ids = (s: ClusterSnapshot) => runPostureChecks(s).map((f) => f.checkId);

describe('runPostureChecks', () => {
  it('clean snapshot yields no findings', () => {
    expect(runPostureChecks(snapshot([pod()]))).toEqual([]);
  });

  it('flags privileged containers as critical', () => {
    const out = runPostureChecks(snapshot([pod({ containers: [container({ privileged: true })] })]));
    expect(out).toContainEqual(expect.objectContaining({ checkId: 'privileged-pod-running', severity: 'critical' }));
  });

  it('flags hostPath mounts', () => {
    expect(ids(snapshot([pod({ hostPathVolumes: ['/var/run/docker.sock'] })]))).toContain('hostpath-mounted');
  });

  it('flags default SA with token automount', () => {
    const p = pod({ serviceAccountName: 'default', automountServiceAccountToken: true });
    expect(ids(snapshot([p]))).toContain('default-sa-token-automounted');
  });

  it('does not flag default SA when automount is explicitly off', () => {
    const p = pod({ serviceAccountName: 'default', automountServiceAccountToken: false });
    expect(ids(snapshot([p]))).not.toContain('default-sa-token-automounted');
  });

  it('flags missing resource limits', () => {
    const p = pod({ containers: [container({ hasCpuLimit: false })] });
    expect(ids(snapshot([p]))).toContain('no-resource-limits');
  });

  it('flags :latest and untagged images, not digest-pinned ones', () => {
    expect(ids(snapshot([pod({ containers: [container({ image: 'reg/app:latest' })] })]))).toContain('latest-image-tag');
    expect(ids(snapshot([pod({ containers: [container({ image: 'reg/app' })] })]))).toContain('latest-image-tag');
    expect(ids(snapshot([pod({ containers: [container({ image: 'reg/app@sha256:abc' })] })]))).not.toContain('latest-image-tag');
  });

  it('flags containers without runAsNonRoot', () => {
    expect(ids(snapshot([pod({ containers: [container({ runAsNonRoot: undefined })] })]))).toContain('runs-as-root');
    expect(ids(snapshot([pod({ containers: [container({ runAsNonRoot: false })] })]))).toContain('runs-as-root');
  });

  it('flags namespaces with pods but no NetworkPolicy', () => {
    expect(ids(snapshot([pod()], { networkPolicyCount: 0 }))).toContain('namespace-without-networkpolicy');
  });

  it('does not flag empty namespaces without NetworkPolicy', () => {
    const s: ClusterSnapshot = { pods: [], namespaces: [{ name: 'empty', podCount: 0, networkPolicyCount: 0 }] };
    expect(runPostureChecks(s)).toEqual([]);
  });

  it('flags secret-looking env vars with literal values', () => {
    const p = pod({ containers: [container({ envVars: [{ name: 'DB_PASSWORD', hasLiteralValue: true }] })] });
    expect(ids(snapshot([p]))).toContain('secret-in-env');
  });

  it('does not flag secret env vars sourced from secretKeyRef', () => {
    const p = pod({ containers: [container({ envVars: [{ name: 'DB_PASSWORD', hasLiteralValue: false }] })] });
    expect(ids(snapshot([p]))).not.toContain('secret-in-env');
  });
});

describe('scoreNamespace', () => {
  it('perfect namespace scores 100', () => expect(scoreNamespace([])).toBe(100));
  it('weights severities and floors at 0', () => {
    const critical = { checkId: 'x', severity: 'critical' as const, namespace: 'prod', resource: 'r', reason: 'z' };
    expect(scoreNamespace([critical])).toBe(75);
    expect(scoreNamespace(Array.from({ length: 10 }, () => critical))).toBe(0);
  });
});
