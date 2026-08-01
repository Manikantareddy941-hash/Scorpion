// Factory mock scoped to this file: the real package is ESM and unparseable
// under ts-jest CJS; the factory keeps the real module from ever loading.
// Both API clients are injected in these tests, so KubeConfig is never used.
jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class { loadFromCluster(): void {} loadFromDefault(): void {} makeApiClient(): object { return {}; } },
  BatchV1Api: class {},
  CoreV1Api: class {},
}));

import { KubernetesJobRunner, loadKubeConfig } from './kubernetesJobRunner';

/** Minimal fakes for the two API clients the runner touches. */
function fakes(statuses: Record<string, unknown>[]) {
  let call = 0;
  const batch = {
    createNamespacedJob: jest.fn(async (_req: { body: { metadata: { name: string } } }) => ({})),
    readNamespacedJob: jest.fn(async () => ({
      status: statuses[Math.min(call++, statuses.length - 1)],
    })),
    deleteNamespacedJob: jest.fn(async (_req: { name: string; propagationPolicy: string }) => ({})),
  };
  const core = {
    listNamespacedPod: jest.fn(async () => ({ items: [{ metadata: { name: 'pod-1' } }] })),
    readNamespacedPodLog: jest.fn(async () => 'hello from the job'),
  };
  return { batch, core };
}

const logger = () => {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
};

const request = { name: 'skeleton', image: 'alpine:3.20', command: ['echo', 'hi'], timeoutSeconds: 30 };

const runWith = (f: ReturnType<typeof fakes>, log = logger()) =>
  new KubernetesJobRunner(
    f.batch as never, f.core as never,
  ).run(request, log);

jest.setTimeout(20_000);

test('dispatches, follows to success, collects output and cleans up', async () => {
  const f = fakes([{ succeeded: 1 }]);

  const outcome = await runWith(f);

  expect(f.batch.createNamespacedJob).toHaveBeenCalledTimes(1);
  expect(outcome).toMatchObject({ exitCode: 0, timedOut: false, logs: 'hello from the job' });
  expect(f.batch.deleteNamespacedJob).toHaveBeenCalledTimes(1);
});

test('the Job is deleted with background propagation, so its pods go with it', async () => {
  // Deleting the Job alone would orphan the pods it created.
  const f = fakes([{ succeeded: 1 }]);

  await runWith(f);

  expect(f.batch.deleteNamespacedJob).toHaveBeenCalledWith(
    expect.objectContaining({ propagationPolicy: 'Background' }),
  );
});

test('a failed Job reports a non-zero exit rather than throwing', async () => {
  const f = fakes([{ failed: 1 }]);

  expect(await runWith(f)).toMatchObject({ exitCode: 1, timedOut: false });
});

test('DeadlineExceeded is surfaced as a timeout, not an ordinary failure', async () => {
  // The cluster enforcing our own activeDeadlineSeconds. A deliberate hang must
  // not be indistinguishable from a failing scan.
  const f = fakes([{ failed: 1, conditions: [{ type: 'Failed', reason: 'DeadlineExceeded' }] }]);

  expect(await runWith(f)).toMatchObject({ exitCode: 1, timedOut: true });
});

test('polls until the Job reports a terminal state', async () => {
  const f = fakes([{ active: 1 }, { active: 1 }, { succeeded: 1 }]);

  expect((await runWith(f)).exitCode).toBe(0);
  expect(f.batch.readNamespacedJob.mock.calls.length).toBeGreaterThanOrEqual(3);
});

test('unreadable logs do not turn a successful run into a failure', async () => {
  // A pod can be evicted or reaped before its output is read; losing the text
  // is not losing the result.
  const f = fakes([{ succeeded: 1 }]);
  f.core.readNamespacedPodLog.mockRejectedValue(new Error('pod gone'));

  const outcome = await runWith(f);

  expect(outcome.exitCode).toBe(0);
  expect(outcome.logs).toBe('');
});

test('cleanup still runs when the Job failed', async () => {
  const f = fakes([{ failed: 1 }]);

  await runWith(f);

  expect(f.batch.deleteNamespacedJob).toHaveBeenCalled();
});

test('a failed cleanup is logged rather than raised over a workload that already ran', async () => {
  // ttlSecondsAfterFinished is the backstop.
  const f = fakes([{ succeeded: 1 }]);
  f.batch.deleteNamespacedJob.mockRejectedValue(new Error('conflict'));
  const log = logger();

  await expect(runWith(f, log)).resolves.toMatchObject({ exitCode: 0 });
  expect(log.lines.join('\n')).toMatch(/Cleanup of .* failed/);
});

test('each dispatch gets a distinct Job name', async () => {
  const f = fakes([{ succeeded: 1 }]);

  await runWith(f);
  await runWith(f);

  const names = f.batch.createNamespacedJob.mock.calls.map((c) => c[0].body.metadata.name);
  expect(names[0]).not.toBe(names[1]);
});

describe('kubeconfig selection', () => {
  const stub = () => {
    const calls: string[] = [];
    return { calls, loadFromCluster: () => calls.push('cluster'), loadFromDefault: () => calls.push('default') };
  };

  test('uses in-cluster credentials when running in a pod', () => {
    const kc = stub();
    loadKubeConfig(kc, { KUBERNETES_SERVICE_HOST: '10.96.0.1' } as NodeJS.ProcessEnv);
    expect(kc.calls).toEqual(['cluster']);
  });

  test('falls back to the local kubeconfig outside a cluster', () => {
    // loadFromCluster does NOT throw when the in-cluster env vars are missing —
    // it builds a config pointing at https://undefined:undefined, so a
    // try/catch fallback never fires and the first API call dies. CI hit
    // exactly this.
    const kc = stub();
    loadKubeConfig(kc, {} as NodeJS.ProcessEnv);
    expect(kc.calls).toEqual(['default']);
  });
});
