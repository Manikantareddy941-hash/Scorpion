jest.mock('../lib/appwrite', () => ({
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: { CANARIES: 'canaries' },
  ID: { unique: () => 'canary-1' },
  Query: {
    equal: (field: string, value: unknown) => ({ equal: [field, value] }),
    orderDesc: (field: string) => ({ orderDesc: field }),
    limit: (n: number) => ({ limit: n }),
  },
}));
jest.mock('./rollbackService', () => ({ triggerRollback: jest.fn() }));
jest.mock('./prometheusMetrics', () => ({ queryCanaryMetrics: jest.fn() }));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));
jest.mock('../services/auditService', () => ({ auditLog: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('../queues/canaryQueue', () => ({ enqueueCanaryCheck: jest.fn() }));

import { databases } from '../lib/appwrite';
import { triggerRollback } from './rollbackService';
import { queryCanaryMetrics } from './prometheusMetrics';
import { createIncident } from '../services/incidentService';
import { enqueueCanaryCheck } from '../queues/canaryQueue';
import { startCanary, runCanaryTick, abortCanary, CanaryAccessError } from './canaryService';

const mockCreate = databases.createDocument as jest.Mock;
const mockGet = databases.getDocument as jest.Mock;
const mockUpdate = databases.updateDocument as jest.Mock;
const mockMetrics = queryCanaryMetrics as jest.MockedFunction<typeof queryCanaryMetrics>;
const mockRollback = triggerRollback as jest.Mock;

const baseDoc = (overrides: Record<string, unknown> = {}) => ({
  $id: 'canary-1',
  user_id: 'user-1',
  app: 'demo',
  namespace: 'prod',
  image: 'reg/app@sha256:abc',
  repo: 'https://github.com/org/demo',
  stableRevision: 'aaa',
  canaryRevision: 'bbb',
  thresholds: JSON.stringify({ maxErrorRatePct: 2 }),
  intervalSec: 60,
  maxFailures: 2,
  requiredChecks: 3,
  status: 'running',
  consecutiveFailures: 0,
  passedChecks: 0,
  checks: '[]',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
});

describe('startCanary', () => {
  it('creates the doc and enqueues the first tick with the interval delay', async () => {
    const { canaryId } = await startCanary({
      app: 'demo', namespace: 'prod', image: 'reg/app@sha256:abc', repo: 'r',
      stableRevision: 'aaa', canaryRevision: 'bbb',
      thresholds: { maxErrorRatePct: 2 },
      intervalSec: 60, maxFailures: 2, requiredChecks: 3, userId: 'user-1',
    });
    expect(canaryId).toBe('canary-1');
    expect(mockCreate).toHaveBeenCalled();
    expect(enqueueCanaryCheck).toHaveBeenCalledWith({ canaryId: 'canary-1', tick: 1 }, 60000);
  });

  it('clamps out-of-range inputs', async () => {
    await startCanary({
      app: 'demo', namespace: 'prod', image: 'i', repo: 'r',
      stableRevision: 'a', canaryRevision: 'b',
      thresholds: { maxErrorRatePct: 2 },
      intervalSec: 1, maxFailures: 99, requiredChecks: 0, userId: 'user-1',
    });
    const payload = mockCreate.mock.calls[0][3];
    expect(payload.intervalSec).toBe(10);
    expect(payload.maxFailures).toBe(10);
    expect(payload.requiredChecks).toBe(1);
  });
});

describe('runCanaryTick', () => {
  it('continue: records the check and enqueues the next tick', async () => {
    mockGet.mockResolvedValue(baseDoc());
    mockMetrics.mockResolvedValue({ errorRatePct: 0.5, p95LatencyMs: null });
    await runCanaryTick('canary-1', 1);
    const update = mockUpdate.mock.calls[0][3];
    expect(update.passedChecks).toBe(1);
    expect(update.consecutiveFailures).toBe(0);
    expect(JSON.parse(update.checks)).toHaveLength(1);
    expect(enqueueCanaryCheck).toHaveBeenCalledWith({ canaryId: 'canary-1', tick: 2 }, 60000);
  });

  it('promote: sets status promoted and does not re-enqueue', async () => {
    mockGet.mockResolvedValue(baseDoc({ passedChecks: 2 }));
    mockMetrics.mockResolvedValue({ errorRatePct: 0.5, p95LatencyMs: null });
    await runCanaryTick('canary-1', 3);
    const update = mockUpdate.mock.calls[0][3];
    expect(update.status).toBe('promoted');
    expect(enqueueCanaryCheck).not.toHaveBeenCalled();
  });

  it('rollback: breach threshold triggers rollback PR + incident + status', async () => {
    mockGet.mockResolvedValue(baseDoc({ consecutiveFailures: 1 }));
    mockMetrics.mockResolvedValue({ errorRatePct: 50, p95LatencyMs: null });
    await runCanaryTick('canary-1', 2);
    const update = mockUpdate.mock.calls[0][3];
    expect(update.status).toBe('rolled_back');
    expect(mockRollback).toHaveBeenCalledWith(
      expect.objectContaining({ app: 'demo', revision: 'bbb' })
    );
    expect(createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'gitops', userId: 'user-1' })
    );
    expect(enqueueCanaryCheck).not.toHaveBeenCalled();
  });

  it('metric unavailable counts as a failed check (fail-secure)', async () => {
    mockGet.mockResolvedValue(baseDoc());
    mockMetrics.mockResolvedValue({ errorRatePct: null, p95LatencyMs: null });
    await runCanaryTick('canary-1', 1);
    const update = mockUpdate.mock.calls[0][3];
    expect(update.consecutiveFailures).toBe(1);
  });

  it('no-ops when the canary is no longer running', async () => {
    mockGet.mockResolvedValue(baseDoc({ status: 'aborted' }));
    await runCanaryTick('canary-1', 5);
    expect(mockMetrics).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a rollback-PR failure still records rolled_back status', async () => {
    mockGet.mockResolvedValue(baseDoc({ consecutiveFailures: 1 }));
    mockMetrics.mockResolvedValue({ errorRatePct: 50, p95LatencyMs: null });
    mockRollback.mockRejectedValue(new Error('github down'));
    await runCanaryTick('canary-1', 2);
    expect(mockUpdate.mock.calls[0][3].status).toBe('rolled_back');
  });
});

describe('abortCanary', () => {
  it('aborts a running canary owned by the caller', async () => {
    mockGet.mockResolvedValue(baseDoc());
    await abortCanary('canary-1', 'user-1');
    expect(mockUpdate.mock.calls[0][3].status).toBe('aborted');
  });

  it('rejects a foreign caller', async () => {
    mockGet.mockResolvedValue(baseDoc());
    await expect(abortCanary('canary-1', 'intruder')).rejects.toBeInstanceOf(CanaryAccessError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws CanaryStateError when already terminal', async () => {
    mockGet.mockResolvedValue(baseDoc({ status: 'promoted' }));
    await expect(abortCanary('canary-1', 'user-1')).rejects.toThrow(/not running/i);
  });
});
