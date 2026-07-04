jest.mock('./redisConnection', () => ({ redisConnection: {} }));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })),
  Worker: jest.fn(),
}));
jest.mock('../repositories/soarRepository', () => ({
  soarRepository: { getAction: jest.fn(), setActionStatus: jest.fn() },
}));
jest.mock('../soar/soarActions', () => ({
  executeSoarAction: jest.fn(),
  createK8sPodActions: jest.fn().mockReturnValue({}),
}));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));
jest.mock('../services/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { processSoarJob } from './soarQueueWorker';
import { soarRepository } from '../repositories/soarRepository';
import { executeSoarAction } from '../soar/soarActions';
import { createIncident } from '../services/incidentService';

const repo = soarRepository as jest.Mocked<typeof soarRepository>;
const exec = executeSoarAction as jest.Mock;

const approved = {
  id: 'act-1',
  status: 'approved',
  actionType: 'kill_pod',
  incidentId: 'inc-1',
  playbookId: 'pb-1',
  playbookName: 'p',
  containerImage: 'img',
  falcoRule: 'r',
  createdAt: 'now',
  namespace: 'prod',
  podName: 'web-1',
};

beforeEach(() => jest.clearAllMocks());

describe('processSoarJob', () => {
  it('executes an approved action and marks executed', async () => {
    repo.getAction.mockResolvedValue(approved as never);
    exec.mockResolvedValue({ ok: true, result: 'done' });
    await processSoarJob({ actionId: 'act-1' });
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'executed', { result: 'done' });
  });

  it('marks failed and escalates on execution failure', async () => {
    repo.getAction.mockResolvedValue(approved as never);
    exec.mockResolvedValue({ ok: false, error: 'forbidden' });
    await processSoarJob({ actionId: 'act-1' });
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'failed', { error: 'forbidden' });
    expect(createIncident).toHaveBeenCalled();
  });

  it('skips non-approved actions (idempotency backstop)', async () => {
    repo.getAction.mockResolvedValue({ ...approved, status: 'executed' } as never);
    await processSoarJob({ actionId: 'act-1' });
    expect(exec).not.toHaveBeenCalled();
    expect(repo.setActionStatus).not.toHaveBeenCalled();
  });

  it('skips missing actions without throwing', async () => {
    repo.getAction.mockResolvedValue(null);
    await expect(processSoarJob({ actionId: 'gone' })).resolves.toBeUndefined();
  });
});
