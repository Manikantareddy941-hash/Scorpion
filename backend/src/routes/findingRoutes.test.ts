jest.mock('../middleware/auth', () => ({ verifyUser: (req: { user?: { $id: string } }, _res: unknown, next: () => void) => { req.user = { $id: 'u1' }; next(); } }));
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
import { canAccessResource } from '../services/tenancyService';

const app = express();
app.use(express.json());
app.use('/api/findings', router);

const getDocument = databases.getDocument as jest.Mock;
const updateDocument = databases.updateDocument as jest.Mock;

beforeEach(() => {
  getDocument.mockReset();
  updateDocument.mockReset();
  (canAccessResource as jest.Mock).mockResolvedValue(true);
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
  // Was 'in_progress' — a status nothing in this system ever produces, and one
  // the allowlist now rejects. 'dismissed' is the real plain-transition case.
  getDocument
    .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
    .mockResolvedValueOnce({ $id: 'r1' });

  const res = await request(app).patch('/api/findings/f1').send({ status: 'dismissed' });

  expect(res.status).toBe(200);
  const payload = updateDocument.mock.calls[0][3];
  expect(payload).not.toHaveProperty('resolvedAt');
  expect(payload).not.toHaveProperty('reopenCount');
});

describe('status validation', () => {
  it('rejects a status outside the allowlist', async () => {
    const res = await request(app).patch('/api/findings/f1').send({ status: 'totally-made-up' });

    expect(res.status).toBe(400);
    // Rejected before any lookup, so an invalid status cannot probe for ids.
    expect(getDocument).not.toHaveBeenCalled();
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('rejects a near-miss that would otherwise vanish from both lists', async () => {
    // 'Resolved' is not 'resolved': the dashboard counts the lowercase form, so
    // this would drop the finding out of open without landing in resolved.
    const res = await request(app).patch('/api/findings/f1').send({ status: 'Resolved' });

    expect(res.status).toBe(400);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('still requires a status', async () => {
    expect((await request(app).patch('/api/findings/f1').send({})).status).toBe(400);
  });

  it('accepts every status the product actually uses', async () => {
    for (const status of ['open', 'resolved', 'remediated', 'dismissed', 'false_positive', 'snoozed']) {
      getDocument.mockReset();
      getDocument
        .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
        .mockResolvedValueOnce({ $id: 'r1' });
      const res = await request(app).patch('/api/findings/f1').send({ status });
      expect([status, res.status]).toEqual([status, 200]);
    }
  });
});

describe('snooze', () => {
  it('normalises snoozeUntil to an ISO timestamp', async () => {
    getDocument
      .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
      .mockResolvedValueOnce({ $id: 'r1' });

    const res = await request(app)
      .patch('/api/findings/f1')
      .send({ status: 'snoozed', snoozeUntil: '2026-08-01T00:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(updateDocument.mock.calls[0][3].snoozeUntil).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rejects an unparseable snoozeUntil rather than storing garbage', async () => {
    getDocument
      .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
      .mockResolvedValueOnce({ $id: 'r1' });

    const res = await request(app)
      .patch('/api/findings/f1')
      .send({ status: 'snoozed', snoozeUntil: 'next tuesday' });

    expect(res.status).toBe(400);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('ignores snoozeUntil on a status that is not a snooze', async () => {
    getDocument
      .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
      .mockResolvedValueOnce({ $id: 'r1' });

    await request(app)
      .patch('/api/findings/f1')
      .send({ status: 'resolved', snoozeUntil: '2026-08-01T00:00:00.000Z' });

    expect(updateDocument.mock.calls[0][3]).not.toHaveProperty('snoozeUntil');
  });
});

describe('access control', () => {
  it('404s on a finding that does not exist', async () => {
    getDocument.mockRejectedValueOnce(new Error('document not found'));

    const res = await request(app).patch('/api/findings/nope').send({ status: 'resolved' });

    expect(res.status).toBe(404);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('404s, not 403s, on another tenant finding', async () => {
    // A 403 here would confirm the finding exists — an enumeration oracle over
    // every finding id in the system.
    (canAccessResource as jest.Mock).mockResolvedValueOnce(false);
    getDocument
      .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
      .mockResolvedValueOnce({ $id: 'r1', user_id: 'someone-else' });

    const res = await request(app).patch('/api/findings/f1').send({ status: 'resolved' });

    expect(res.status).toBe(404);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('404s when the finding has no repository to authorise against', async () => {
    // Without a repo there is nothing to check access on, so it must not be
    // treated as permitted by default.
    getDocument.mockResolvedValueOnce({ $id: 'f1', status: 'open' });

    const res = await request(app).patch('/api/findings/f1').send({ status: 'resolved' });

    expect(res.status).toBe(404);
    expect(updateDocument).not.toHaveBeenCalled();
  });
});

describe('GET /api/findings/:id', () => {
  it('returns the finding with its repository', async () => {
    getDocument
      .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
      .mockResolvedValueOnce({ $id: 'r1', url: 'https://github.com/acme/api' });

    const res = await request(app).get('/api/findings/f1');

    expect(res.status).toBe(200);
    expect(res.body.finding.$id).toBe('f1');
    expect(res.body.repo.$id).toBe('r1');
    // The repo is reached via the finding's own repo_id. The panel used to hop
    // through `scan_result_id`, which nothing writes.
    expect(getDocument.mock.calls[1][2]).toBe('r1');
  });

  it('404s, not 403s, on another tenant finding', async () => {
    (canAccessResource as jest.Mock).mockResolvedValueOnce(false);
    getDocument
      .mockResolvedValueOnce({ $id: 'f1', status: 'open', repo_id: 'r1' })
      .mockResolvedValueOnce({ $id: 'r1', user_id: 'someone-else' });

    const res = await request(app).get('/api/findings/f1');

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('finding');
  });

  it('404s when the finding has no repository to authorise against', async () => {
    getDocument.mockResolvedValueOnce({ $id: 'f1', status: 'open' });

    const res = await request(app).get('/api/findings/f1');

    expect(res.status).toBe(404);
  });
});
