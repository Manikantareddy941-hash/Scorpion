jest.mock('./redisConnection', () => ({ redisConnection: {} }));

const mockAdd = jest.fn();
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockAdd })),
}));

import { enqueueCorrelationTick } from './correlationQueue';

describe('enqueueCorrelationTick jobId', () => {
  afterEach(() => {
    mockAdd.mockClear();
  });

  test('re-enqueues landing in different minute buckets get different jobIds', () => {
    const minuteM = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(minuteM);
    enqueueCorrelationTick({ ownerUserId: 'u1' }, 60000);

    nowSpy.mockReturnValue(minuteM + 60000);
    enqueueCorrelationTick({ ownerUserId: 'u1' }, 60000);

    nowSpy.mockRestore();

    const jobId1 = (mockAdd.mock.calls[0][2] as { jobId: string }).jobId;
    const jobId2 = (mockAdd.mock.calls[1][2] as { jobId: string }).jobId;
    expect(jobId1).not.toBe(jobId2);
  });

  test('seeds within the same minute and delay dedupe to the same jobId', () => {
    const minuteM = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(minuteM);

    enqueueCorrelationTick({ ownerUserId: 'u1' }, 60000);
    enqueueCorrelationTick({ ownerUserId: 'u1' }, 60000);

    nowSpy.mockRestore();

    const jobId1 = (mockAdd.mock.calls[0][2] as { jobId: string }).jobId;
    const jobId2 = (mockAdd.mock.calls[1][2] as { jobId: string }).jobId;
    expect(jobId1).toBe(jobId2);
  });
});
