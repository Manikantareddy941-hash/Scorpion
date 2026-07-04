jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }),
    createDocument: jest.fn().mockResolvedValue({ $id: 'inc-doc-1' }),
    getDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: { SCANS: 'scans', REPOSITORIES: 'repositories', INCIDENTS: 'incidents', INTEGRATIONS: 'integrations' },
  ID: { unique: () => 'new-id' },
  Query: { equal: jest.fn(), orderDesc: jest.fn(), limit: jest.fn() },
}));
jest.mock('../services/logEvents', () => ({ logRuntimeThreat: jest.fn() }));
jest.mock('../services/metrics', () => ({ runtimeThreats: { inc: jest.fn() } }));
jest.mock('../services/tracing', () => ({ withSpan: (_n: string, _a: unknown, fn: () => unknown) => fn() }));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));
jest.mock('../services/auditService', () => ({ auditLog: jest.fn() }));
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('../repositories/soarRepository', () => ({
  soarRepository: { listPlaybooks: jest.fn(), createAction: jest.fn() },
}));
jest.mock('../queues/soarQueue', () => ({ enqueueSoarAction: jest.fn() }));
jest.mock('../repositories/falcoRuleRepository', () => ({
  falcoRuleRepository: { listRules: jest.fn().mockResolvedValue([]) },
}), { virtual: true });

import { handleFalcoEvent } from './falcoHandler';
import { soarRepository } from '../repositories/soarRepository';
import { enqueueSoarAction } from '../queues/soarQueue';

const repo = soarRepository as jest.Mocked<typeof soarRepository>;

const event = {
  rule: 'Terminal shell in container',
  priority: 'Critical',
  output: 'shell spawned',
  time: new Date().toISOString(),
  output_fields: {
    'container.id': 'c1',
    'container.image.repository': 'reg/app',
    'k8s.ns.name': 'prod',
    'k8s.pod.name': 'web-1',
  },
};

beforeEach(() => jest.clearAllMocks());

describe('falcoHandler SOAR dispatch', () => {
  it('creates an approved action and enqueues for auto execution', async () => {
    repo.listPlaybooks.mockResolvedValue([{
      id: 'pb-1', name: 'p', enabled: true,
      trigger: { rulePattern: 'Terminal shell*', minPriority: 'Warning' },
      actions: [{ type: 'capture_evidence', mode: 'auto' }],
    }]);
    repo.createAction.mockResolvedValue({ id: 'act-1' } as never);

    await handleFalcoEvent(event);

    expect(repo.createAction).toHaveBeenCalledWith(expect.objectContaining({
      status: 'approved', actionType: 'capture_evidence', namespace: 'prod', podName: 'web-1',
    }));
    expect(enqueueSoarAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'act-1' }));
  });

  it('creates a pending action without enqueueing for approval-gated steps', async () => {
    repo.listPlaybooks.mockResolvedValue([{
      id: 'pb-1', name: 'p', enabled: true,
      trigger: { minPriority: 'Warning' },
      actions: [{ type: 'kill_pod', mode: 'approval' }],
    }]);
    repo.createAction.mockResolvedValue({ id: 'act-2' } as never);

    await handleFalcoEvent(event);

    expect(repo.createAction).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(enqueueSoarAction).not.toHaveBeenCalled();
  });

  it('SOAR failure never breaks the incident path', async () => {
    repo.listPlaybooks.mockRejectedValue(new Error('boom'));
    await expect(handleFalcoEvent(event)).resolves.toBeUndefined();
  });
});
