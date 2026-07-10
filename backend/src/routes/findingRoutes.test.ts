jest.mock('../middleware/auth', () => ({ verifyUser: (req: any, _res: any, next: any) => { req.user = { $id: 'u1' }; next(); } }));
jest.mock('../services/tenancyService', () => ({ canAccessResource: jest.fn().mockResolvedValue(true) }));
jest.mock('../utils/auditLogger', () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../lib/appwrite', () => ({
  databases: { getDocument: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'db',
  COLLECTIONS: { REPOSITORIES: 'repositories', FINDINGS: 'vulnerabilities' },
}));

import express from 'express';
import request from 'supertest';
import router from './findingRoutes';
import { databases } from '../lib/appwrite';

const app = express();
app.use(express.json());
app.use('/api/findings', router);

const getDocument = databases.getDocument as jest.Mock;
const updateDocument = databases.updateDocument as jest.Mock;

beforeEach(() => {
  getDocument.mockReset();
  updateDocument.mockReset();
  updateDocument.mockResolvedValue({ $id: 'f1', title: 'Finding', repo_id: 'r1', status: 'resolved' });
});

test('resolving a finding sets resolvedAt on the update payload', async () => {
  getDocument
    .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' }) // existing finding
    .mockResolvedValueOnce({ $id: 'r1' }); // repo

  const res = await request(app).patch('/api/findings/f1').send({ status: 'resolved' });

  expect(res.status).toBe(200);
  const payload = updateDocument.mock.calls[0][3];
  expect(payload).toHaveProperty('resolvedAt');
  expect(updateDocument.mock.calls[0][1]).toBe('vulnerabilities');
});

test('reopening a resolved finding bumps reopenCount from prior value', async () => {
  getDocument
    .mockResolvedValueOnce({ $id: 'f1', status: 'resolved', reopenCount: 2, repo_id: 'r1' })
    .mockResolvedValueOnce({ $id: 'r1' });

  const res = await request(app).patch('/api/findings/f1').send({ status: 'open' });

  expect(res.status).toBe(200);
  const payload = updateDocument.mock.calls[0][3];
  expect(payload.reopenCount).toBe(3);
  expect(payload).not.toHaveProperty('resolvedAt');
});

test('a plain status change adds neither resolvedAt nor reopenCount', async () => {
  getDocument
    .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
    .mockResolvedValueOnce({ $id: 'r1' });

  const res = await request(app).patch('/api/findings/f1').send({ status: 'in_progress' });

  expect(res.status).toBe(200);
  const payload = updateDocument.mock.calls[0][3];
  expect(payload).not.toHaveProperty('resolvedAt');
  expect(payload).not.toHaveProperty('reopenCount');
});
