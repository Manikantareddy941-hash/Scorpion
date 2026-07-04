jest.mock('@kubernetes/client-node');
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/auditService', () => ({ auditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }) },
  DB_ID: 'test-db',
  Query: { equal: jest.fn(), limit: jest.fn() },
}));

import { executeSoarAction, K8sPodActions } from './soarActions';
import type { SoarActionRecord } from '../repositories/soarRepository';

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
});
