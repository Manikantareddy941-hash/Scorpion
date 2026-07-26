jest.mock('../middleware/auth', () => ({ verifyUser: (req: { user?: { $id: string } }, _res: unknown, next: () => void) => { req.user = { $id: 'u1' }; next(); } }));
jest.mock('../services/tenancyService', () => ({ resolveOwnershipScope: jest.fn().mockResolvedValue({ field: 'user_id', value: 'u1' }) }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn() }, DB_ID: 'db',
  COLLECTIONS: { REPOSITORIES: 'repositories', FINDINGS: 'vulnerabilities', INCIDENTS: 'incidents' },
  Query: { equal: () => 'q', limit: () => 'l', orderDesc: () => 'o', greaterThanEqual: () => 'g' },
}));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
import express from 'express';
import request from 'supertest';
import router from './monitorFeedbackRoutes';
import { databases } from '../lib/appwrite';
import { logger } from '../services/logger';

const app = express(); app.use(express.json()); app.use('/api/monitor/feedback', router);

test('composes MTTR, reopen rate, and escape-by-phase', async () => {
  (databases.listDocuments as jest.Mock)
    .mockResolvedValueOnce({ documents: [{ $id: 'r1' }] })            // repos
    .mockResolvedValueOnce({ documents: [                              // findings
      { severity: 'high', scanner: 'semgrep', status: 'resolved', $createdAt: '1970-01-01T00:00:00.000Z', resolvedAt: '1970-01-01T00:00:00.100Z', reopenCount: 0 },
    ], total: 1 })
    .mockResolvedValueOnce({ documents: [] });                        // incidents
  const res = await request(app).get('/api/monitor/feedback');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('mttr');
  expect(res.body).toHaveProperty('reopenRate');
  expect(res.body).toHaveProperty('byPhase');
});

test('returns ranked escape recommendations directed at the earlier gate', async () => {
  (databases.listDocuments as jest.Mock)
    .mockResolvedValueOnce({ documents: [{ $id: 'r1' }] })            // repos
    .mockResolvedValueOnce({ documents: [                              // findings: 2 at test (zap), 1 at build (semgrep)
      { severity: 'high', scanner: 'zap', status: 'open', $createdAt: '1970-01-01T00:00:00.000Z' },
      { severity: 'high', scanner: 'zap', status: 'open', $createdAt: '1970-01-01T00:00:00.000Z' },
      { severity: 'high', scanner: 'semgrep', status: 'open', $createdAt: '1970-01-01T00:00:00.000Z' },
    ], total: 3 })
    .mockResolvedValueOnce({ documents: [] });                        // incidents
  const res = await request(app).get('/api/monitor/feedback');
  expect(res.status).toBe(200);
  expect(res.body.recommendations[0].phase).toBe('test'); // biggest leak first
  expect(res.body.recommendations[0].count).toBe(2);
  expect(res.body.recommendations[0].recommendation).toMatch(/build gate/i);
});

test('folds resolved runtime (Falco) incidents into MTTR and the operate escape phase', async () => {
  (databases.listDocuments as jest.Mock)
    .mockResolvedValueOnce({ documents: [{ $id: 'r1' }] })            // repos
    .mockResolvedValueOnce({ documents: [], total: 0 })              // findings: none
    .mockResolvedValueOnce({ documents: [                             // incidents
      { $id: 'inc1', priority: 'Critical', scanner: undefined, status: 'resolved', repo_id: 'r1', timestamp: '1970-01-01T00:00:00.000Z', resolvedAt: '1970-01-01T00:10:00.000Z' },
    ] });
  const res = await request(app).get('/api/monitor/feedback');
  expect(res.status).toBe(200);
  // 10 minutes in ms — proves the incident's timestamp/resolvedAt drove MTTR.
  expect(res.body.mttr).toBe(600_000);
  expect(res.body.byPhase).toEqual([{ phase: 'operate', count: 1 }]);
});

test('fails open: a runtime-incident read error leaves the findings metrics intact', async () => {
  (databases.listDocuments as jest.Mock)
    .mockResolvedValueOnce({ documents: [{ $id: 'r1' }] })            // repos
    .mockResolvedValueOnce({ documents: [                              // findings
      { severity: 'high', scanner: 'semgrep', status: 'resolved', $createdAt: '1970-01-01T00:00:00.000Z', resolvedAt: '1970-01-01T00:00:00.100Z', reopenCount: 0 },
    ], total: 1 })
    .mockRejectedValueOnce(new Error('incidents.repo_id attribute missing')); // pre-migration
  const res = await request(app).get('/api/monitor/feedback');
  expect(res.status).toBe(200);
  expect(res.body.mttr).toBe(100); // findings metric unaffected
  expect(res.body.byPhase).toEqual([{ phase: 'build', count: 1 }]);
  // ...but the degraded read is logged, not silent (audit finding #4).
  const degraded = (logger.warn as jest.Mock).mock.calls.find(
    (c) => (c[1] as { event?: string })?.event === 'feedback_read_degraded',
  );
  expect(degraded).toBeTruthy();
});
