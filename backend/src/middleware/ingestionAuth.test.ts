jest.mock('../lib/appwrite', () => ({
    databases: { getDocument: jest.fn() },
    DB_ID: 'test-db',
    COLLECTIONS: { REPOSITORIES: 'repositories' },
}));

jest.mock('../db/pool', () => ({ isPostgresEnabled: jest.fn(() => true) }));

jest.mock('../repositories/pg/ciTokenRepository', () => ({
    ciTokenRepository: { verify: jest.fn() },
}));

jest.mock('../services/tenancyService', () => ({
    canAccessResource: jest.fn(),
}));

// requireActual so errorContext stays real — a wholesale mock leaves it
// undefined and the spread in the catch throws instead of asserting.
jest.mock('../services/logger', () => ({
    ...jest.requireActual('../services/logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type { Request, Response, NextFunction } from 'express';
import { databases } from '../lib/appwrite';
import { ciTokenRepository } from '../repositories/pg/ciTokenRepository';
import { canAccessResource } from '../services/tenancyService';
import { validateIngestionAuth } from './ingestionAuth';

const getDocument = databases.getDocument as jest.Mock;
const verify = ciTokenRepository.verify as jest.Mock;
const canAccess = canAccessResource as jest.Mock;

type Ctx = { req: Request; res: Response; next: NextFunction; status: jest.Mock; json: jest.Mock };

function ctx(opts: { body?: unknown; headers?: Record<string, string>; user?: { $id: string } }): Ctx {
    const headers = opts.headers ?? {};
    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    const req = {
        body: opts.body,
        user: opts.user,
        ip: '203.0.113.9',
        socket: { remoteAddress: '203.0.113.9' },
        originalUrl: '/api/logs',
        headers,
        header: (n: string) => headers[n.toLowerCase()],
    } as unknown as Request;
    return { req, res: { status, json } as unknown as Response, next: jest.fn(), status, json };
}

describe('validateIngestionAuth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.CI_INGEST_API_KEY;
    });

    // These endpoints write to audit_logs. The assertion that matters throughout
    // is `next` NOT being called — a status code alone would not prove the
    // handler below was never reached.
    it('rejects a request carrying no credential at all', async () => {
        const c = ctx({ body: { repoId: 'repo-1' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(401);
        expect(getDocument).not.toHaveBeenCalled();
    });

    it('rejects a missing repoId before touching any credential', async () => {
        const c = ctx({ body: {}, headers: { 'x-api-key': 'tok' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(400);
        expect(verify).not.toHaveBeenCalled();
    });

    // The core tenancy property: a VALID token is not enough, because repoId
    // comes from the body and the body is caller-controlled.
    it('refuses a valid token writing against another tenant\'s repo', async () => {
        verify.mockResolvedValue({ team_id: 'team-A', user_id: 'user-A' });
        getDocument.mockResolvedValue({ $id: 'repo-1', team_id: 'team-B', user_id: 'user-B' });
        const c = ctx({ body: { repoId: 'repo-1' }, headers: { 'x-api-key': 'valid-token' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(403);
    });

    it('admits a token whose tenant owns the repo', async () => {
        verify.mockResolvedValue({ team_id: 'team-A', user_id: 'user-A' });
        getDocument.mockResolvedValue({ $id: 'repo-1', team_id: 'team-A' });
        const c = ctx({ body: { repoId: 'repo-1' }, headers: { 'x-api-key': 'valid-token' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).toHaveBeenCalled();
    });

    it('rejects an unrecognised api key rather than falling through to the session path', async () => {
        verify.mockResolvedValue(null);
        const c = ctx({ body: { repoId: 'repo-1' }, headers: { 'x-api-key': 'bogus' }, user: { $id: 'user-A' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(401);
        expect(canAccess).not.toHaveBeenCalled();
    });

    it('admits a session user with access to the repo', async () => {
        getDocument.mockResolvedValue({ $id: 'repo-1', user_id: 'user-A' });
        canAccess.mockResolvedValue(true);
        const c = ctx({ body: { repoId: 'repo-1' }, user: { $id: 'user-A' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).toHaveBeenCalled();
    });

    it('refuses a session user without access to the repo', async () => {
        getDocument.mockResolvedValue({ $id: 'repo-1', user_id: 'someone-else' });
        canAccess.mockResolvedValue(false);
        const c = ctx({ body: { repoId: 'repo-1' }, user: { $id: 'user-A' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(403);
    });

    // A repo read that fails is indistinguishable from a repo that does not
    // exist, because loadRepo swallows it — so this lands on 403, not the catch.
    it('refuses the write when the repo cannot be read', async () => {
        getDocument.mockRejectedValue(new Error('appwrite down'));
        const c = ctx({ body: { repoId: 'repo-1' }, user: { $id: 'user-A' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(403);
    });

    // Fail CLOSED, and specifically through the catch: the repo READS fine and
    // the access check itself throws, which is the path a tenancy-service or
    // team-membership outage takes. An earlier version of this test mocked
    // getDocument to reject and asserted 403 — it passed, but it was landing on
    // repo_not_found and never entering the catch at all.
    it('returns 503 when the access check itself throws', async () => {
        getDocument.mockResolvedValue({ $id: 'repo-1', user_id: 'user-A' });
        canAccess.mockRejectedValue(new Error('team lookup failed'));
        const c = ctx({ body: { repoId: 'repo-1' }, user: { $id: 'user-A' } });

        await validateIngestionAuth(c.req, c.res, c.next);

        expect(c.next).not.toHaveBeenCalled();
        expect(c.status).toHaveBeenCalledWith(503);
    });
});
