jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/auditService', () => ({ auditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }) },
  DB_ID: 'test-db',
  COLLECTIONS: { INTEGRATIONS: 'integrations' },
  Query: { equal: jest.fn(), limit: jest.fn() },
}));

import { executeSoarAction, createK8sPodActionsImpl, K8sPodActions, QUARANTINE_LABEL } from './soarActions';
import type { SoarActionRecord } from '../repositories/soarRepository';
import { databases, Query } from '../lib/appwrite';

const k8s = (): jest.Mocked<K8sPodActions> => ({
  getPodJson: jest.fn().mockResolvedValue('{"kind":"Pod"}'),
  labelPod: jest.fn().mockResolvedValue(undefined),
  deletePod: jest.fn().mockResolvedValue(undefined),
  ensureQuarantinePolicy: jest.fn().mockResolvedValue(undefined),
});

const action = (over: Partial<SoarActionRecord> = {}): SoarActionRecord => ({
  id: 'act-1', incidentId: 'inc-1', actionType: 'isolate_pod', playbookId: 'pb-1',
  playbookName: 'Shell response', status: 'approved', namespace: 'prod', podName: 'web-1',
  containerImage: 'img', falcoRule: 'Terminal shell in container',
  createdAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('executeSoarAction', () => {
  it('isolate_pod ensures quarantine policy then labels the pod', async () => {
    const deps = { k8s: k8s() };
    const out = await executeSoarAction(action(), deps);
    expect(out.ok).toBe(true);
    expect(deps.k8s.ensureQuarantinePolicy).toHaveBeenCalledWith('prod');
    expect(deps.k8s.labelPod).toHaveBeenCalledWith('prod', 'web-1', 'scorpion-quarantine', 'true');
  });

  it('kill_pod deletes the pod', async () => {
    const deps = { k8s: k8s() };
    const out = await executeSoarAction(action({ actionType: 'kill_pod' }), deps);
    expect(out.ok).toBe(true);
    expect(deps.k8s.deletePod).toHaveBeenCalledWith('prod', 'web-1');
  });

  it('capture_evidence returns pod json + event json as result', async () => {
    const deps = { k8s: k8s(), falcoEventJson: '{"rule":"x"}' };
    const out = await executeSoarAction(action({ actionType: 'capture_evidence' }), deps);
    expect(out).toEqual({ ok: true, result: expect.stringContaining('"kind":"Pod"') });
  });

  it('destructive action without namespace/pod fails with a reason, never throws', async () => {
    const out = await executeSoarAction(action({ namespace: undefined, podName: undefined }), { k8s: k8s() });
    expect(out).toEqual({ ok: false, error: expect.stringContaining('namespace/pod') });
  });

  it('k8s failure is captured, not thrown', async () => {
    const deps = { k8s: k8s() };
    deps.k8s.deletePod.mockRejectedValue(new Error('forbidden'));
    const out = await executeSoarAction(action({ actionType: 'kill_pod' }), deps);
    expect(out).toEqual({ ok: false, error: expect.stringContaining('forbidden') });
  });

  it('slack_escalate without an owner user id fails and never lists integrations (fail-secure)', async () => {
    const deps = { k8s: k8s() };
    const out = await executeSoarAction(action({ actionType: 'slack_escalate' }), deps);
    expect(out).toEqual({ ok: false, error: expect.stringContaining('owner user id') });
    expect(databases.listDocuments).not.toHaveBeenCalled();
  });

  it('slack_escalate scopes the integration lookup to the incident owner, not every tenant', async () => {
    (databases.listDocuments as jest.Mock).mockResolvedValue({
      total: 1,
      documents: [{ isEnabled: true, slack_webhook: 'https://hooks.slack.test/x' }],
    });
    const deps = { k8s: k8s(), ownerUserId: 'user-42' };
    const out = await executeSoarAction(action({ actionType: 'slack_escalate' }), deps);
    expect(out.ok).toBe(true);
    expect(Query.equal).toHaveBeenCalledWith('userId', 'user-42');
    expect(databases.listDocuments).toHaveBeenCalledWith('test-db', 'integrations', expect.anything());
  });
});

describe('createK8sPodActionsImpl', () => {
  class FakeCoreV1Api {}
  class FakeNetworkingV1Api {}

  function fakeK8sClient(core: unknown, net: unknown): typeof import('@kubernetes/client-node') {
    class FakeKubeConfig {
      loadFromDefault(): void {}
      makeApiClient(ctor: unknown): unknown {
        return ctor === FakeCoreV1Api ? core : net;
      }
    }
    return {
      KubeConfig: FakeKubeConfig,
      CoreV1Api: FakeCoreV1Api,
      NetworkingV1Api: FakeNetworkingV1Api,
    } as unknown as typeof import('@kubernetes/client-node');
  }

  // Pins the patch request shape: @kubernetes/client-node v1.4.0 always
  // negotiates application/json-patch+json for patchNamespacedPod (fixed
  // candidate order in ObjectSerializer, no per-call override), so the body
  // must be an RFC 6902 JSON Patch array, not a merge-style plain object.
  it('labelPod sends a JSON Patch array merging existing labels', async () => {
    const patchNamespacedPod = jest.fn().mockResolvedValue(undefined);
    const core = {
      readNamespacedPod: jest.fn().mockResolvedValue({ metadata: { labels: { team: 'checkout' } } }),
      patchNamespacedPod,
    };
    const k8sActions = createK8sPodActionsImpl(fakeK8sClient(core, {}));

    await k8sActions.labelPod('prod', 'web-1', QUARANTINE_LABEL, 'true');

    expect(patchNamespacedPod).toHaveBeenCalledTimes(1);
    const { body } = patchNamespacedPod.mock.calls[0][0] as { body: unknown };
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([
      { op: 'add', path: '/metadata/labels', value: { team: 'checkout', [QUARANTINE_LABEL]: 'true' } },
    ]);
  });

  it('labelPod still produces a valid patch array when the pod has no existing labels map', async () => {
    const patchNamespacedPod = jest.fn().mockResolvedValue(undefined);
    const core = {
      readNamespacedPod: jest.fn().mockResolvedValue({ metadata: {} }),
      patchNamespacedPod,
    };
    const k8sActions = createK8sPodActionsImpl(fakeK8sClient(core, {}));

    await k8sActions.labelPod('prod', 'web-1', QUARANTINE_LABEL, 'true');

    const { body } = patchNamespacedPod.mock.calls[0][0] as { body: unknown };
    expect(body).toEqual([{ op: 'add', path: '/metadata/labels', value: { [QUARANTINE_LABEL]: 'true' } }]);
  });
});
