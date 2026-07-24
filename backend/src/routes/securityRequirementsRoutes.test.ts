import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

jest.mock('../services/securityRequirementsService', () => ({
  securityRequirementsService: {
    getProfile: jest.fn(),
    saveProfile: jest.fn(),
    generate: jest.fn(),
    list: jest.fn(),
    setLifecycle: jest.fn(),
    pushToTicket: jest.fn(),
  },
}));

import securityRequirementsRoutes from './securityRequirementsRoutes';
import { securityRequirementsService as svc } from '../services/securityRequirementsService';

const mock = svc as unknown as {
  getProfile: jest.Mock; saveProfile: jest.Mock; generate: jest.Mock;
  list: jest.Mock; setLifecycle: jest.Mock; pushToTicket: jest.Mock;
};

const buildApp = (userId = 'user-1') => {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: { $id: string; email?: string } }, _res: Response, next: NextFunction) => {
    req.user = { $id: userId, email: 'user1@example.com' };
    next();
  });
  app.use('/api/plan', securityRequirementsRoutes);
  return app;
};

const validProfile = {
  appType: 'api', stack: ['node'], dataTypes: ['card'],
  deployment: 'cloud', authModel: 'session', frameworks: ['PCI DSS'],
};

describe('securityRequirementsRoutes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('PUT profile rejects an invalid enum with 400 and never calls the service', async () => {
    const res = await request(buildApp())
      .put('/api/plan/projects/p1/profile')
      .send({ ...validProfile, appType: 'nonsense' });

    expect(res.statusCode).toBe(400);
    expect(mock.saveProfile).not.toHaveBeenCalled();
  });

  it('PUT profile persists a valid profile scoped to the session user', async () => {
    mock.saveProfile.mockResolvedValue({ ok: true, data: { projectId: 'p1', ...validProfile } });
    const res = await request(buildApp()).put('/api/plan/projects/p1/profile').send(validProfile);

    expect(res.statusCode).toBe(200);
    expect(mock.saveProfile).toHaveBeenCalledWith('p1', expect.objectContaining({ appType: 'api' }), 'user-1');
  });

  it('GET requirements returns 404 when the project is not the caller\'s', async () => {
    mock.list.mockResolvedValue('denied');
    const res = await request(buildApp()).get('/api/plan/projects/p1/requirements');
    expect(res.statusCode).toBe(404);
  });

  it('GET requirements returns the list when owned', async () => {
    mock.list.mockResolvedValue({ ok: true, data: [{ code: 'REQ-A' }] });
    const res = await request(buildApp()).get('/api/plan/projects/p1/requirements');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ code: 'REQ-A' }]);
  });

  it('POST generate returns 400 when no profile is configured yet', async () => {
    mock.generate.mockResolvedValue('no_profile');
    const res = await request(buildApp()).post('/api/plan/projects/p1/requirements/generate');
    expect(res.statusCode).toBe(400);
  });

  it('PATCH sets updatedBy from the session, never from the request body', async () => {
    mock.setLifecycle.mockResolvedValue({ ok: true, data: { $id: 'r1' } });
    const res = await request(buildApp())
      .patch('/api/plan/requirements/r1')
      .send({ lifecycleStatus: 'waived', justification: 'accepted risk', updatedBy: 'attacker@evil' });

    expect(res.statusCode).toBe(200);
    expect(mock.setLifecycle).toHaveBeenCalledWith(
      'r1',
      { lifecycleStatus: 'waived', justification: 'accepted risk' },
      'user-1',
      'user1@example.com',
    );
  });

  it('PATCH rejects an invalid lifecycleStatus (obsolete is system-managed)', async () => {
    const res = await request(buildApp())
      .patch('/api/plan/requirements/r1')
      .send({ lifecycleStatus: 'obsolete' });
    expect(res.statusCode).toBe(400);
    expect(mock.setLifecycle).not.toHaveBeenCalled();
  });

  it('PATCH returns 404 when the requirement is not found or not owned', async () => {
    mock.setLifecycle.mockResolvedValue('not_found');
    const res = await request(buildApp())
      .patch('/api/plan/requirements/r1')
      .send({ lifecycleStatus: 'satisfied' });
    expect(res.statusCode).toBe(404);
  });

  it('POST ticket pushes the requirement with session-derived ownership', async () => {
    mock.pushToTicket.mockResolvedValue({ ok: true, alreadyLinked: false, ticketId: 'tk1', jiraKey: 'SEC-42' });
    const res = await request(buildApp()).post('/api/plan/requirements/r1/ticket');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, alreadyLinked: false, ticketId: 'tk1', jiraKey: 'SEC-42' });
    expect(mock.pushToTicket).toHaveBeenCalledWith('r1', 'user-1', 'user1@example.com', { user_id: 'user-1', team_id: null });
  });

  it('POST ticket returns 404 when the requirement is not found or not owned', async () => {
    mock.pushToTicket.mockResolvedValue('not_found');
    const res = await request(buildApp()).post('/api/plan/requirements/r1/ticket');
    expect(res.statusCode).toBe(404);
  });
});
