jest.mock('../middleware/auth', () => ({
  verifyUser: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    // emailVerification is required by requireEmailVerification on POST /,
    // which gates token creation. Real callers of this route are verified.
    req.user = { $id: 'user-alice', email: 'alice@acme.test', emailVerification: true };
    next();
  },
}));
jest.mock('../db/pool', () => ({ isPostgresEnabled: () => true, getPool: jest.fn(), closePool: jest.fn() }));
jest.mock('../repositories/pg/ciTokenRepository', () => ({
  ciTokenRepository: { create: jest.fn(), listForOwner: jest.fn(), revoke: jest.fn() },
}));
jest.mock('../services/tenancyService', () => ({
  resolveCreationOwnership: jest.fn(async () => ({ user_id: 'user-alice', team_id: null })),
  TenantAccessError: class extends Error {},
}));

import express from 'express';
import request from 'supertest';
import router from './ciTokenRoutes';
import { ciTokenRepository } from '../repositories/pg/ciTokenRepository';

const app = express();
app.use(express.json());
app.use('/api/ci-tokens', router);

const repo = ciTokenRepository as jest.Mocked<typeof ciTokenRepository>;

const summary = {
  id: 't1', name: 'ci-runner', scope: 'ingest' as const,
  createdAt: '2026-07-18T00:00:00.000Z', lastUsedAt: null, revokedAt: null,
};

beforeEach(() => jest.clearAllMocks());

describe('POST /api/ci-tokens', () => {
  it('returns the plaintext token exactly once, with a warning', async () => {
    repo.create.mockResolvedValue({ token: 'scrp_abc', summary });
    const res = await request(app).post('/api/ci-tokens').send({ name: 'ci-runner' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBe('scrp_abc');
    expect(res.body.warning).toMatch(/cannot be retrieved again/i);
  });

  it('defaults to the ingest scope', async () => {
    repo.create.mockResolvedValue({ token: 'scrp_abc', summary });
    await request(app).post('/api/ci-tokens').send({ name: 'ci-runner' });
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), 'ci-runner', 'ingest');
  });

  it('takes ownership from the session, not the request body', async () => {
    // A body-supplied owner would let a caller mint a token acting as another tenant.
    repo.create.mockResolvedValue({ token: 'scrp_abc', summary });
    await request(app).post('/api/ci-tokens').send({ name: 'x', user_id: 'user-bob' });
    expect(repo.create).toHaveBeenCalledWith({ user_id: 'user-alice', team_id: null }, 'x', 'ingest');
  });

  it('rejects a missing name', async () => {
    const res = await request(app).post('/api/ci-tokens').send({});
    expect(res.status).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an over-long name', async () => {
    const res = await request(app).post('/api/ci-tokens').send({ name: 'a'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown scope', async () => {
    const res = await request(app).post('/api/ci-tokens').send({ name: 'x', scope: 'admin' });
    expect(res.status).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/ci-tokens', () => {
  it('lists only the caller tokens and never a secret', async () => {
    repo.listForOwner.mockResolvedValue([summary]);
    const res = await request(app).get('/api/ci-tokens');
    expect(res.status).toBe(200);
    expect(repo.listForOwner).toHaveBeenCalledWith('user-alice');
    expect(JSON.stringify(res.body)).not.toContain('scrp_');
  });
});

describe('DELETE /api/ci-tokens/:id', () => {
  it('revokes a token the caller owns', async () => {
    repo.revoke.mockResolvedValue(true);
    const res = await request(app).delete('/api/ci-tokens/t1');
    expect(res.status).toBe(204);
    expect(repo.revoke).toHaveBeenCalledWith('t1', 'user-alice');
  });

  it("returns 404 — not 403 — for a token the caller does not own", async () => {
    // 403 would confirm the id exists, turning this into an id oracle.
    repo.revoke.mockResolvedValue(false);
    const res = await request(app).delete('/api/ci-tokens/someone-elses');
    expect(res.status).toBe(404);
  });
});
