import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string; email?: string; role?: string } };

jest.mock('../repositories/soarRepository', () => ({
  soarRepository: {
    listPlaybooks: jest.fn(), createPlaybook: jest.fn(), updatePlaybook: jest.fn(),
    getAction: jest.fn(), listActions: jest.fn(), setActionStatus: jest.fn(),
  },
}));
jest.mock('../queues/soarQueue', () => ({ enqueueSoarAction: jest.fn() }));
jest.mock('../middleware/requireRole', () => ({
  requireRole: () => (_req: Request, _res: unknown, next: () => void) => next(),
}));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import soarRoutes from './soarRoutes';
import { soarRepository } from '../repositories/soarRepository';
import { enqueueSoarAction } from '../queues/soarQueue';

const repo = soarRepository as jest.Mocked<typeof soarRepository>;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: MockAuthRequest, _res, next) => {
    req.user = { $id: 'user-1', email: 'sec@scorpion' };
    next();
  });
  app.use('/api/soar', soarRoutes);
  return app;
};

const validPlaybook = {
  name: 'Shell response',
  enabled: true,
  trigger: { rulePattern: 'Terminal shell*', minPriority: 'Warning' },
  actions: [{ type: 'isolate_pod', mode: 'approval' }],
};

const pendingAction = {
  id: 'act-1', incidentId: 'inc-1', actionType: 'kill_pod', playbookId: 'pb-1',
  playbookName: 'p', status: 'pending', containerImage: 'img', falcoRule: 'r',
  createdAt: 'now', ownerUserId: 'user-42',
};

beforeEach(() => jest.clearAllMocks());

describe('soarRoutes', () => {
  it('POST /playbooks creates and returns 201', async () => {
    repo.createPlaybook.mockResolvedValue({ id: 'pb-1', ...validPlaybook } as never);
    const res = await request(buildApp()).post('/api/soar/playbooks').send(validPlaybook);
    expect(res.statusCode).toBe(201);
    expect(res.body.playbook.id).toBe('pb-1');
  });

  it('POST /playbooks rejects unknown action type with 400', async () => {
    const bad = { ...validPlaybook, actions: [{ type: 'rm_rf', mode: 'auto' }] };
    const res = await request(buildApp()).post('/api/soar/playbooks').send(bad);
    expect(res.statusCode).toBe(400);
    expect(repo.createPlaybook).not.toHaveBeenCalled();
  });

  it('POST /actions/:id/approve approves a pending action and enqueues', async () => {
    repo.getAction.mockResolvedValue(pendingAction as never);
    const res = await request(buildApp()).post('/api/soar/actions/act-1/approve');
    expect(res.statusCode).toBe(200);
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'approved', { resolvedBy: 'sec@scorpion' });
    expect(enqueueSoarAction).toHaveBeenCalledWith({ actionId: 'act-1', ownerUserId: 'user-42' });
  });

  it('POST /actions/:id/approve returns 409 for non-pending (no double execution)', async () => {
    repo.getAction.mockResolvedValue({ ...pendingAction, status: 'executed' } as never);
    const res = await request(buildApp()).post('/api/soar/actions/act-1/approve');
    expect(res.statusCode).toBe(409);
    expect(enqueueSoarAction).not.toHaveBeenCalled();
  });

  it('POST /actions/:id/reject rejects a pending action', async () => {
    repo.getAction.mockResolvedValue(pendingAction as never);
    const res = await request(buildApp()).post('/api/soar/actions/act-1/reject');
    expect(res.statusCode).toBe(200);
    expect(repo.setActionStatus).toHaveBeenCalledWith('act-1', 'rejected', { resolvedBy: 'sec@scorpion' });
  });

  it('POST /actions/:id/approve returns 404 when action not found', async () => {
    repo.getAction.mockResolvedValue(null);
    const res = await request(buildApp()).post('/api/soar/actions/missing/approve');
    expect(res.statusCode).toBe(404);
    expect(enqueueSoarAction).not.toHaveBeenCalled();
  });

  it('POST /actions/:id/reject returns 404 when action not found', async () => {
    repo.getAction.mockResolvedValue(null);
    const res = await request(buildApp()).post('/api/soar/actions/missing/reject');
    expect(res.statusCode).toBe(404);
    expect(repo.setActionStatus).not.toHaveBeenCalled();
  });

  it('GET /playbooks returns 500 when listing throws', async () => {
    repo.listPlaybooks.mockRejectedValue(new Error('down'));
    const res = await request(buildApp()).get('/api/soar/playbooks');
    expect(res.statusCode).toBe(500);
  });

  it('GET /actions filters by status', async () => {
    repo.listActions.mockResolvedValue([pendingAction] as never);
    const res = await request(buildApp()).get('/api/soar/actions?status=pending');
    expect(res.statusCode).toBe(200);
    expect(repo.listActions).toHaveBeenCalledWith('pending');
  });
});
