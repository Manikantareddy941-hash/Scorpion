jest.mock('../queues/redisConnection', () => ({
  redisConnection: { status: 'ready', set: jest.fn(), eval: jest.fn() }
}));
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import { acquireLock, releaseLock } from './redisLock';
import { redisConnection } from '../queues/redisConnection';

const redis = redisConnection as unknown as {
  status: string;
  set: jest.Mock;
  eval: jest.Mock;
};

beforeEach(() => {
  redis.status = 'ready';
  redis.set.mockReset();
  redis.eval.mockReset();
});

test('acquires a redis lease with NX + PX', async () => {
  redis.set.mockResolvedValue('OK');

  const handle = await acquireLock('iac:ws:w1', 60000);

  expect(handle).not.toBeNull();
  expect(handle!.local).toBe(false);
  expect(redis.set).toHaveBeenCalledWith('iac:ws:w1', handle!.token, 'PX', 60000, 'NX');
});

test('returns null when the lease is already held', async () => {
  redis.set.mockResolvedValue(null);

  expect(await acquireLock('iac:ws:w1', 60000)).toBeNull();
});

test('release runs the compare-and-delete script with the owned token', async () => {
  redis.set.mockResolvedValue('OK');
  redis.eval.mockResolvedValue(1);

  const handle = await acquireLock('iac:ws:w1', 60000);
  await releaseLock(handle!);

  expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('del'), 1, 'iac:ws:w1', handle!.token);
});

test('falls back to an in-process lock when redis is not ready', async () => {
  redis.status = 'connecting';

  const first = await acquireLock('iac:ws:w2', 60000);
  const second = await acquireLock('iac:ws:w2', 60000);

  expect(first!.local).toBe(true);
  expect(second).toBeNull();
  expect(redis.set).not.toHaveBeenCalled();

  await releaseLock(first!);
  expect(await acquireLock('iac:ws:w2', 60000)).not.toBeNull();
});
