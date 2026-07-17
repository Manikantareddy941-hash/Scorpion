import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string; email?: string } };

// This suite asserts against the mocked Appwrite data layer, so pin the storage
// facade to its legacy path — otherwise CI (which sets DATABASE_URL) would route
// repoRepository to Postgres and bypass these mocks. The Postgres data path is
// covered by src/repositories/pg/repoPgRepository.test.ts.
jest.mock('../db/pool', () => ({
    isPostgresEnabled: () => false,
    getPool: jest.fn(),
    closePool: jest.fn(),
}));
jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        getDocument: jest.fn(),
        deleteDocument: jest.fn(),
        createDocument: jest.fn(),
        updateDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { REPOSITORIES: 'repositories', SCANS: 'scans', PROJECT_POLICIES: 'project_policies', PROJECT_ACCESS: 'project_access', TEAMS: 'teams' },
    ID: { unique: () => 'unique-id' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        limit: (n: number) => ({ limit: n }),
    },
}));
jest.mock('../services/ingestionService', () => ({
    cleanupWorkspace: jest.fn(),
}));
jest.mock('../queues/scanQueue', () => ({
    enqueueScan: jest.fn(),
}));
// octokit packages are ESM-only and blow up jest's CJS parser - never load them in route tests
jest.mock('../github/appInstallations', () => ({
    listInstallationRepos: jest.fn(),
}));
// Partial mocks: iamMiddleware.hasPermission (used by deleteRepo) needs the real
// evaluateIAM/DEFAULT_IAM_POLICY exports, so only override what the tests stub.
jest.mock('../services/policyService', () => ({
    ...jest.requireActual('../services/policyService'),
    getEffectivePolicy: jest.fn(),
}));
jest.mock('../services/rbacService', () => ({
    ...jest.requireActual('../services/rbacService'),
    hasRequiredRole: jest.fn(),
}));
// The real limiter 429s after a few hits within one test file - not what we test here.
jest.mock('../middleware/rateLimiters', () => ({
    ...jest.requireActual('../middleware/rateLimiters'),
    scanTriggerLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import repoRoutes from './repoRoutes';
import { databases } from '../lib/appwrite';
import { cleanupWorkspace } from '../services/ingestionService';
import { listInstallationRepos } from '../github/appInstallations';
import { repoService } from '../services/repoService';
import { getEffectivePolicy } from '../services/policyService';
import { hasRequiredRole } from '../services/rbacService';
import { TenantAccessError } from '../services/tenancyService';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: MockAuthRequest, _res, next) => {
        req.user = { $id: 'user-1', email: 'user1@example.com' };
        next();
    });
    app.use('/api/repos', repoRoutes);
    return app;
};

describe('repoRoutes DELETE /:id', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects deleting a repository the caller cannot access at all', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'someone-else' });

        const res = await request(buildApp()).delete('/api/repos/repo-1');

        expect(res.statusCode).toBe(403);
        expect(databases.deleteDocument).not.toHaveBeenCalled();
    });

    it('deletes the repository and cleans up its workspace when the caller owns it', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1', local_path: '/tmp/extract-1' });
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0, documents: [] });
        (databases.deleteDocument as jest.Mock).mockResolvedValue(undefined);

        const res = await request(buildApp()).delete('/api/repos/repo-1');

        expect(res.statusCode).toBe(204);
        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', 'repositories', 'repo-1');
        expect(cleanupWorkspace).toHaveBeenCalledWith('/tmp/extract-1');
    });

    it('refuses to delete a repository with a scan in progress', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1' });
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 1, documents: [{ $id: 'scan-1' }] });

        const res = await request(buildApp()).delete('/api/repos/repo-1');

        expect(res.statusCode).toBe(409);
        expect(databases.deleteDocument).not.toHaveBeenCalled();
    });
});

describe('repoRoutes GET /github/installations', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns every repo visible to the GitHub App installation', async () => {
        (listInstallationRepos as jest.Mock).mockResolvedValue([
            { installation_id: 1, account: 'acme', name: 'api', full_name: 'acme/api', html_url: 'https://github.com/acme/api', private: true },
        ]);

        const res = await request(buildApp()).get('/api/repos/github/installations');

        expect(res.statusCode).toBe(200);
        expect(res.body.repos).toHaveLength(1);
        expect(res.body.repos[0].full_name).toBe('acme/api');
    });

    it('returns 503 when the GitHub App is not configured', async () => {
        (listInstallationRepos as jest.Mock).mockRejectedValue(new Error('GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)'));

        const res = await request(buildApp()).get('/api/repos/github/installations');

        expect(res.statusCode).toBe(503);
    });
});

describe('repoRoutes POST /bulk-connect', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    it('connects each url and reports the ones that failed', async () => {
        const syncSpy = jest.spyOn(repoService, 'syncRepo')
            .mockResolvedValueOnce({ $id: 'r1' } as never)
            .mockRejectedValueOnce(new Error('clone failed'));

        const res = await request(buildApp())
            .post('/api/repos/bulk-connect')
            .send({ urls: ['https://github.com/acme/api', 'https://github.com/acme/web'] });

        expect(res.statusCode).toBe(200);
        expect(res.body.connected).toBe(1);
        expect(res.body.failed).toEqual(['https://github.com/acme/web']);
        expect(syncSpy).toHaveBeenCalledTimes(2);
    });

    it('rejects an empty url list', async () => {
        const res = await request(buildApp())
            .post('/api/repos/bulk-connect')
            .send({ urls: [] });

        expect(res.statusCode).toBe(400);
    });
});

describe('repoRoutes add/list', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    it('POST / syncs a repository', async () => {
        jest.spyOn(repoService, 'syncRepo').mockResolvedValue({ $id: 'r1' } as never);

        const res = await request(buildApp()).post('/api/repos').send({ url: 'https://github.com/a/b' });

        expect(res.statusCode).toBe(200);
        expect(res.body.$id).toBe('r1');
    });

    it('POST / rejects invalid payloads and tenant violations', async () => {
        expect((await request(buildApp()).post('/api/repos').send({ url: 'not-a-url' })).statusCode).toBe(400);

        jest.spyOn(repoService, 'syncRepo').mockRejectedValue(new TenantAccessError('cross-tenant'));
        expect((await request(buildApp()).post('/api/repos').send({ url: 'https://github.com/a/b' })).statusCode).toBe(403);
    });

    it('GET / lists the caller repos and maps tenant errors to 403', async () => {
        const listSpy = jest.spyOn(repoService, 'listRepos').mockResolvedValue([{ $id: 'r1' }] as never);
        expect((await request(buildApp()).get('/api/repos')).body).toHaveLength(1);

        listSpy.mockRejectedValue(new TenantAccessError('cross-tenant'));
        expect((await request(buildApp()).get('/api/repos')).statusCode).toBe(403);
    });
});

describe('repoRoutes external providers', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    it('GET /external requires provider and token', async () => {
        expect((await request(buildApp()).get('/api/repos/external?provider=gitlab')).statusCode).toBe(400);
        expect((await request(buildApp()).get('/api/repos/external').set('x-provider-token', 't')).statusCode).toBe(400);
    });

    it('GET /external lists provider repos and maps provider failures to 500', async () => {
        const spy = jest.spyOn(repoService, 'listExternalRepos').mockResolvedValue([{ name: 'x' }] as never);
        const ok = await request(buildApp()).get('/api/repos/external?provider=gitlab').set('x-provider-token', 't');
        expect(ok.statusCode).toBe(200);
        expect(ok.body.repos).toHaveLength(1);

        spy.mockRejectedValue(new Error('provider down'));
        const bad = await request(buildApp()).get('/api/repos/external?provider=gitlab').set('x-provider-token', 't');
        expect(bad.statusCode).toBe(500);
    });

    it('POST /external/scan requires the provider token and fires-and-forgets', async () => {
        const payload = { provider: 'gitlab', repoFullName: 'a/b', cloneUrl: 'https://gitlab.com/a/b.git' };
        expect((await request(buildApp()).post('/api/repos/external/scan').send(payload)).statusCode).toBe(400);

        jest.spyOn(repoService, 'triggerExternalScan').mockReturnValue('workdir-1' as never);
        const res = await request(buildApp()).post('/api/repos/external/scan').set('x-provider-token', 't').send(payload);
        expect(res.statusCode).toBe(202);
        expect(res.body.workDir).toBe('workdir-1');
    });
});

describe('repoRoutes scan trigger and status', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    it('POST /:id/scan maps every service outcome to its status code', async () => {
        const spy = jest.spyOn(repoService, 'triggerScan');

        spy.mockResolvedValue('scan_in_progress');
        expect((await request(buildApp()).post('/api/repos/r1/scan').send({})).statusCode).toBe(409);

        spy.mockResolvedValue('not_found');
        expect((await request(buildApp()).post('/api/repos/r1/scan').send({})).statusCode).toBe(400);

        spy.mockResolvedValue('forbidden');
        expect((await request(buildApp()).post('/api/repos/r1/scan').send({})).statusCode).toBe(403);

        spy.mockResolvedValue({ scanId: 'scan-9' } as never);
        const ok = await request(buildApp()).post('/api/repos/r1/scan').send({ scanType: 'full' });
        expect(ok.statusCode).toBe(200);
        expect(ok.body.scanId).toBe('scan-9');
    });

    it('GET /scans/:scanId maps outcomes to 404/403/200', async () => {
        const spy = jest.spyOn(repoService, 'getScanStatus');

        spy.mockResolvedValue('not_found');
        expect((await request(buildApp()).get('/api/repos/scans/s1')).statusCode).toBe(404);

        spy.mockResolvedValue('forbidden');
        expect((await request(buildApp()).get('/api/repos/scans/s1')).statusCode).toBe(403);

        spy.mockResolvedValue({ data: { id: 's1', status: 'completed' } } as never);
        const ok = await request(buildApp()).get('/api/repos/scans/s1');
        expect(ok.statusCode).toBe(200);
        expect(ok.body.status).toBe('completed');
    });
});

describe('repoRoutes governance policy', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET /:id/policy denies non-viewers and returns the effective policy for viewers', async () => {
        (hasRequiredRole as jest.Mock).mockResolvedValue(false);
        expect((await request(buildApp()).get('/api/repos/r1/policy')).statusCode).toBe(403);

        (hasRequiredRole as jest.Mock).mockResolvedValue(true);
        (getEffectivePolicy as jest.Mock).mockResolvedValue({ policy_name: 'balanced' });
        const ok = await request(buildApp()).get('/api/repos/r1/policy');
        expect(ok.body.policy_name).toBe('balanced');
    });

    it('PUT /:id/policy validates the preset and requires admin', async () => {
        expect((await request(buildApp()).put('/api/repos/r1/policy').send({ policy_name: 'nonsense' })).statusCode).toBe(400);

        (hasRequiredRole as jest.Mock).mockResolvedValue(false);
        expect((await request(buildApp()).put('/api/repos/r1/policy').send({ policy_name: 'strict' })).statusCode).toBe(403);
    });

    it('PUT /:id/policy updates an existing policy row or creates a fresh one', async () => {
        (hasRequiredRole as jest.Mock).mockResolvedValue(true);
        (getEffectivePolicy as jest.Mock).mockResolvedValue({ policy_name: 'strict' });

        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 1, documents: [{ $id: 'pol-1' }] });
        (databases.updateDocument as jest.Mock).mockResolvedValue({});
        await request(buildApp()).put('/api/repos/r1/policy').send({ policy_name: 'strict' });
        expect(databases.updateDocument).toHaveBeenCalled();

        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0, documents: [] });
        (databases.createDocument as jest.Mock).mockResolvedValue({});
        await request(buildApp()).put('/api/repos/r1/policy').send({ policy_name: 'relaxed' });
        expect(databases.createDocument).toHaveBeenCalledWith(
            'test-db', expect.anything(), expect.anything(),
            expect.objectContaining({ policy_name: 'relaxed', max_critical: 2 })
        );
    });
});

describe('repoRoutes team access', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET /:id/access denies non-viewers and enriches team names for viewers', async () => {
        (hasRequiredRole as jest.Mock).mockResolvedValue(false);
        expect((await request(buildApp()).get('/api/repos/r1/access')).statusCode).toBe(403);

        (hasRequiredRole as jest.Mock).mockResolvedValue(true);
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ $id: 'a1', repo_id: 'r1', team_id: 'team-1' }] });
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'team-1', name: 'Red Team' });

        const ok = await request(buildApp()).get('/api/repos/r1/access');
        expect(ok.body[0]).toMatchObject({ team_id: 'team-1', teams: { name: 'Red Team' } });
    });

    it('PUT /:id/access validates input, requires admin, grants and revokes', async () => {
        expect((await request(buildApp()).put('/api/repos/r1/access').send({ action: 'grant' })).statusCode).toBe(400);
        expect((await request(buildApp()).put('/api/repos/r1/access').send({ team_id: 't1', action: 'explode' })).statusCode).toBe(400);

        (hasRequiredRole as jest.Mock).mockResolvedValue(false);
        expect((await request(buildApp()).put('/api/repos/r1/access').send({ team_id: 't1', action: 'grant' })).statusCode).toBe(403);

        (hasRequiredRole as jest.Mock).mockResolvedValue(true);
        (databases.createDocument as jest.Mock).mockResolvedValue({});

        // grant when no existing row → creates
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0, documents: [] });
        expect((await request(buildApp()).put('/api/repos/r1/access').send({ team_id: 't1', action: 'grant' })).statusCode).toBe(200);
        expect(databases.createDocument).toHaveBeenCalled();

        // revoke when a row exists → deletes
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 1, documents: [{ $id: 'row-1' }] });
        expect((await request(buildApp()).put('/api/repos/r1/access').send({ team_id: 't1', action: 'revoke' })).statusCode).toBe(200);
        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', expect.anything(), 'row-1');
    });
});
