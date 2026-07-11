jest.mock('../middleware/auth', () => ({ verifyUser: (req: { user?: { $id: string } }, _res: unknown, next: () => void) => { req.user = { $id: 'u1' }; next(); } }));
jest.mock('../repositories/suppressionRepository', () => ({
  suppressionRepository: {
    listForOwner: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 's1', matchType: 'ruleId', matchValue: 'test', expiresAt: undefined, reason: 'test' }),
    remove: jest.fn().mockResolvedValue(true),
  },
}));

import express from 'express';
import request from 'supertest';
import router from './monitorSuppressionRoutes';
import { suppressionRepository } from '../repositories/suppressionRepository';

const app = express(); app.use(express.json()); app.use('/api/monitor/suppressions', router);

test('GET / lists owner suppressions', async () => {
  (suppressionRepository.listForOwner as jest.Mock).mockResolvedValue([
    { id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit', expiresAt: undefined, reason: 'noisy' },
  ]);
  const res = await request(app).get('/api/monitor/suppressions');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].id).toBe('s1');
});

test('POST / with invalid matchType returns 400', async () => {
  const res = await request(app).post('/api/monitor/suppressions').send({ matchType: 'invalid', matchValue: 'test' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBeDefined();
});

test('POST / with missing matchValue returns 400', async () => {
  const res = await request(app).post('/api/monitor/suppressions').send({ matchType: 'ruleId' });
  expect(res.status).toBe(400);
});

test('POST / with valid data creates suppression and returns 201', async () => {
  const res = await request(app).post('/api/monitor/suppressions').send({ matchType: 'ruleId', matchValue: 'test', reason: 'test' });
  expect(res.status).toBe(201);
  expect(res.body.id).toBe('s1');
  expect(suppressionRepository.create).toHaveBeenCalledWith('u1', expect.objectContaining({ matchType: 'ruleId', matchValue: 'test' }));
});

test('DELETE /:id with valid id removes suppression', async () => {
  const res = await request(app).delete('/api/monitor/suppressions/s1');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(suppressionRepository.remove).toHaveBeenCalledWith('u1', 's1');
});

test('DELETE /:id with unknown id returns 404', async () => {
  (suppressionRepository.remove as jest.Mock).mockResolvedValue(false);
  const res = await request(app).delete('/api/monitor/suppressions/unknown');
  expect(res.status).toBe(404);
});
