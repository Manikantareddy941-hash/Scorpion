jest.mock('../middleware/auth', () => ({ verifyUser: (req: { user?: { $id: string } }, _res: unknown, next: () => void) => { req.user = { $id: 'u1' }; next(); } }));
jest.mock('../services/tenancyService', () => ({ resolveOwnershipScope: jest.fn().mockResolvedValue({ field: 'user_id', value: 'u1' }) }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn() }, DB_ID: 'db',
  COLLECTIONS: { REPOSITORIES: 'repositories', FINDINGS: 'vulnerabilities' },
  Query: { equal: () => 'q', limit: () => 'l', orderDesc: () => 'o', greaterThanEqual: () => 'g' },
}));
import express from 'express';
import request from 'supertest';
import router from './monitorFeedbackRoutes';
import { databases } from '../lib/appwrite';

const app = express(); app.use(express.json()); app.use('/api/monitor/feedback', router);

test('composes MTTR, reopen rate, and escape-by-phase', async () => {
  (databases.listDocuments as jest.Mock)
    .mockResolvedValueOnce({ documents: [{ $id: 'r1' }] })            // repos
    .mockResolvedValueOnce({ documents: [                              // findings
      { severity: 'high', scanner: 'semgrep', status: 'resolved', $createdAt: '1970-01-01T00:00:00.000Z', resolvedAt: '1970-01-01T00:00:00.100Z', reopenCount: 0 },
    ], total: 1 });
  const res = await request(app).get('/api/monitor/feedback');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('mttr');
  expect(res.body).toHaveProperty('reopenRate');
  expect(res.body).toHaveProperty('byPhase');
});
