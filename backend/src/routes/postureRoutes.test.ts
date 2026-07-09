import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../repositories/postureRepository', () => ({
  postureRepository: { listSnapshots: jest.fn() },
}));
jest.mock('../middleware/requireRole', () => ({
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import postureRoutes from './postureRoutes';
import { postureRepository } from '../repositories/postureRepository';

const repo = postureRepository as jest.Mocked<typeof postureRepository>;

const buildApp = () => {
  const app = express();
  app.use('/api/posture', postureRoutes);
  return app;
};

describe('postureRoutes', () => {
  it('GET / returns snapshots in the standard envelope', async () => {
    repo.listSnapshots.mockResolvedValue([
      { namespace: 'prod', score: 92, findings: [], updatedAt: 'now' },
    ]);
    const res = await request(buildApp()).get('/api/posture');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [{ namespace: 'prod', score: 92, findings: [], updatedAt: 'now' }],
      meta: { total: 1 },
    });
  });

  it('GET / surfaces repository failure as 500', async () => {
    repo.listSnapshots.mockRejectedValue(new Error('down'));
    const res = await request(buildApp()).get('/api/posture');
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to list posture snapshots' });
  });
});
