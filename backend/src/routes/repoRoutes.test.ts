import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string; email?: string } };

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        getDocument: jest.fn(),
        deleteDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { REPOSITORIES: 'repositories', SCANS: 'scans' },
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

import repoRoutes from './repoRoutes';
import { databases } from '../lib/appwrite';
import { cleanupWorkspace } from '../services/ingestionService';
import { listInstallationRepos } from '../github/appInstallations';
import { repoService } from '../services/repoService';

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
