jest.mock('../middleware/auth', () => ({ verifyUser: (req: any, _res: any, next: any) => { req.user = { $id: 'u1' }; next(); } }));
jest.mock('../services/tenancyService', () => ({ resolveOwnershipScope: jest.fn().mockResolvedValue({ field: 'user_id', value: 'u1' }) }));
jest.mock('../repositories/correlationRepository', () => ({
  correlationRepository: { listFired: jest.fn().mockResolvedValue([]), listRuleStates: jest.fn().mockResolvedValue([]), upsertRuleState: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import router from './monitorCorrelationRoutes';
import { correlationRepository } from '../repositories/correlationRepository';

const app = express(); app.use(express.json()); app.use('/api/monitor/correlations', router);

test('GET /rules returns the 5-rule catalog with owner state', async () => {
  const res = await request(app).get('/api/monitor/correlations/rules');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(5);
  expect(res.body[0]).toHaveProperty('enabled', true);
});

test('PUT /rules/:id persists a toggle', async () => {
  const res = await request(app).put('/api/monitor/correlations/rules/account-takeover').send({ enabled: false });
  expect(res.status).toBe(200);
  expect(correlationRepository.upsertRuleState).toHaveBeenCalledWith('u1', { id: 'account-takeover', enabled: false, severityOverride: undefined });
});
