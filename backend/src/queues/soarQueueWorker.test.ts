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
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
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

  it('plumbs ownerUserId from the job payload into the executor context', async () => {
    repo.getAction.mockResolvedValue(approved as never);
    exec.mockResolvedValue({ ok: true, result: 'done' });
    await processSoarJob({ actionId: 'act-1', ownerUserId: 'user-42' });
    expect(exec).toHaveBeenCalledWith(
      approved,
      expect.objectContaining({ ownerUserId: 'user-42' }),
    );
  });

  it('does not throw (no BullMQ retry) when status write fails after successful execution', async () => {
    repo.getAction.mockResolvedValue(approved as never);
    exec.mockResolvedValue({ ok: true, result: 'done' });
    repo.setActionStatus.mockRejectedValue(new Error('appwrite down'));
    await expect(processSoarJob({ actionId: 'act-1' })).resolves.toBeUndefined();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('falls back to the action record ownerUserId when the job payload omits it', async () => {
    const withOwner = { ...approved, ownerUserId: 'action-owner-1' };
    repo.getAction.mockResolvedValue(withOwner as never);
    exec.mockResolvedValue({ ok: true, result: 'done' });
    await processSoarJob({ actionId: 'act-1' });
    expect(exec).toHaveBeenCalledWith(
      withOwner,
      expect.objectContaining({ ownerUserId: 'action-owner-1' }),
    );
  });

  it('still creates the fail-loud incident when setActionStatus(failed) rejects', async () => {
    repo.getAction.mockResolvedValue(approved as never);
    exec.mockResolvedValue({ ok: false, error: 'forbidden' });
    repo.setActionStatus.mockRejectedValue(new Error('appwrite down'));
    await expect(processSoarJob({ actionId: 'act-1' })).rejects.toThrow('appwrite down');
    expect(createIncident).toHaveBeenCalled();
  });

  it('still marks the action failed when createIncident rejects', async () => {
    repo.getAction.mockResolvedValue(approved as never);
    repo.setActionStatus.mockResolvedValue(undefined);
    exec.mockResolvedValue({ ok: false, error: 'forbidden' });
    (createIncident as jest.Mock).mockRejectedValue(new Error('incident svc down'));
    await expect(processSoarJob({ actionId: 'act-1' })).resolves.toBeUndefined();
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'failed', { error: 'forbidden' });
  });
});
