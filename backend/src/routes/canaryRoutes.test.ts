import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string } };

jest.mock('../lib/appwrite', () => ({
  databases: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: { CANARIES: 'canaries' },
  Query: {
    equal: (field: string, value: unknown) => ({ equal: [field, value] }),
    orderDesc: (field: string) => ({ orderDesc: field }),
    limit: (n: number) => ({ limit: n }),
  },
}));
jest.mock('../gitops/canaryService', () => {
  class CanaryAccessError extends Error {}
  class CanaryStateError extends Error {}
  return {
    startCanary: jest.fn(),
    abortCanary: jest.fn(),
    CanaryAccessError,
    CanaryStateError,
  };
});
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import canaryRoutes from './canaryRoutes';
import { databases } from '../lib/appwrite';
import { startCanary, abortCanary, CanaryAccessError, CanaryStateError } from '../gitops/canaryService';

const buildApp = (userId = 'user-1') => {
  const app = express();
  app.use(express.json());
  app.use((req: MockAuthRequest, _res, next) => {
    req.user = { $id: userId };
    next();
  });
  app.use('/api/canary', canaryRoutes);
  return app;
};

const validBody = {
  app: 'demo',
  namespace: 'prod',
  image: 'reg/app@sha256:abc',
  repo: 'https://github.com/org/demo',
  stableRevision: 'aaa',
  canaryRevision: 'bbb',
  thresholds: { maxErrorRatePct: 2 },
  intervalSec: 60,
  maxFailures: 2,
  requiredChecks: 3,
};

beforeEach(() => jest.clearAllMocks());

describe('canaryRoutes', () => {
  it('POST / starts a canary and returns 202', async () => {
    (startCanary as jest.Mock).mockResolvedValue({ canaryId: 'canary-1' });
    const res = await request(buildApp()).post('/api/canary').send(validBody);
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ canaryId: 'canary-1', status: 'running' });
    expect(startCanary).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('POST / rejects a missing app with 400', async () => {
    const rest: Partial<typeof validBody> = { ...validBody };
    delete rest.app;
    const res = await request(buildApp()).post('/api/canary').send(rest);
    expect(res.statusCode).toBe(400);
    expect(startCanary).not.toHaveBeenCalled();
  });

  it('POST / rejects a bad threshold with 400', async () => {
    const res = await request(buildApp())
      .post('/api/canary')
      .send({ ...validBody, thresholds: { maxErrorRatePct: 500 } });
    expect(res.statusCode).toBe(400);
  });

  it('GET / lists the caller\'s canaries with parsed JSON columns', async () => {
    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: [
        {
          $id: 'c1', $createdAt: 'now', user_id: 'user-1',
          checks: '[{"passed":true}]', thresholds: '{"maxErrorRatePct":2}',
          status: 'running',
        },
      ],
    });
    const res = await request(buildApp()).get('/api/canary');
    expect(res.statusCode).toBe(200);
    expect(res.body.canaries[0].checks).toEqual([{ passed: true }]);
    expect(res.body.canaries[0].thresholds.maxErrorRatePct).toBe(2);
  });

  it('GET /:id returns 403 for a foreign canary', async () => {
    (databases.getDocument as jest.Mock).mockResolvedValue({
      $id: 'c1', user_id: 'someone-else', checks: '[]', thresholds: '{}',
    });
    const res = await request(buildApp()).get('/api/canary/c1');
    expect(res.statusCode).toBe(403);
  });

  it('POST /:id/abort maps access errors to 403', async () => {
    (abortCanary as jest.Mock).mockRejectedValue(new CanaryAccessError('nope'));
    const res = await request(buildApp()).post('/api/canary/c1/abort');
    expect(res.statusCode).toBe(403);
  });

  it('POST /:id/abort maps state errors to 409', async () => {
    (abortCanary as jest.Mock).mockRejectedValue(new CanaryStateError('not running'));
    const res = await request(buildApp()).post('/api/canary/c1/abort');
    expect(res.statusCode).toBe(409);
  });

  it('POST /:id/abort succeeds for the owner', async () => {
    (abortCanary as jest.Mock).mockResolvedValue(undefined);
    const res = await request(buildApp()).post('/api/canary/c1/abort');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('aborted');
  });
});
