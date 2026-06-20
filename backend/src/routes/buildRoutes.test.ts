import request from 'supertest';
import express from 'express';

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        getDocument: jest.fn(),
        updateDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { BUILD_PIPELINES: 'build_pipelines', BUILD_ARTIFACTS: 'build_artifacts', REPOSITORIES: 'repositories' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        orderDesc: (field: string) => ({ orderDesc: field }),
        limit: (n: number) => ({ limit: n }),
    },
}));
jest.mock('../build/buildService', () => ({
    startBuild: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
    auditLog: jest.fn().mockResolvedValue(undefined),
}));

import buildRoutes from './buildRoutes';
import { databases } from '../lib/appwrite';
import { startBuild } from '../build/buildService';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
        req.user = { $id: 'user-1', email: 'user1@example.com' };
        next();
    });
    app.use('/api/builds', buildRoutes);
    return app;
};

describe('buildRoutes ownership checks', () => {
    beforeEach(() => jest.clearAllMocks());

    it('POST /trigger rejects triggering a build on a repo the caller cannot access', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'someone-else' });

        const res = await request(buildApp())
            .post('/api/builds/trigger')
            .send({ repoId: 'repo-1', branch: 'main' });

        expect(res.statusCode).toBe(403);
        expect(startBuild).not.toHaveBeenCalled();
    });

    it('POST /trigger starts a build when the caller owns the repo', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1' });
        (startBuild as jest.Mock).mockResolvedValue('pipeline-1');

        const res = await request(buildApp())
            .post('/api/builds/trigger')
            .send({ repoId: 'repo-1', branch: 'main' });

        expect(res.statusCode).toBe(202);
        expect(res.body.pipelineId).toBe('pipeline-1');
    });

    it('GET /:id rejects fetching a build whose repo the caller cannot access', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'build-1', repoId: 'repo-1' }) // build doc
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'someone-else' }); // repo doc (assertRepoAccess)

        const res = await request(buildApp()).get('/api/builds/build-1');

        expect(res.statusCode).toBe(403);
    });

    it('GET /:id returns the build when the caller owns its repo', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'build-1', repoId: 'repo-1', status: 'success' })
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'user-1' });

        const res = await request(buildApp()).get('/api/builds/build-1');

        expect(res.statusCode).toBe(200);
        expect(res.body.$id).toBe('build-1');
    });

    it('POST /:id/cancel rejects cancelling a build whose repo the caller cannot access', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'build-1', repoId: 'repo-1', status: 'running' })
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'someone-else' });

        const res = await request(buildApp()).post('/api/builds/build-1/cancel');

        expect(res.statusCode).toBe(403);
        expect(databases.updateDocument).not.toHaveBeenCalled();
    });

    it('GET /:id/artifacts rejects fetching artifacts for a build the caller cannot access', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'build-1', repoId: 'repo-1' })
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'someone-else' });

        const res = await request(buildApp()).get('/api/builds/build-1/artifacts');

        expect(res.statusCode).toBe(403);
        expect(databases.listDocuments).not.toHaveBeenCalled();
    });

    it('GET / scopes the unfiltered list to the caller\'s accessible repos', async () => {
        (databases.listDocuments as jest.Mock)
            .mockResolvedValueOnce({ documents: [{ $id: 'repo-1' }, { $id: 'repo-2' }] }) // owned repos lookup
            .mockResolvedValueOnce({ documents: [{ $id: 'build-1' }] }); // builds lookup

        const res = await request(buildApp()).get('/api/builds');

        expect(res.statusCode).toBe(200);
        expect(databases.listDocuments).toHaveBeenLastCalledWith('test-db', 'build_pipelines', [
            { orderDesc: '$createdAt' },
            { limit: 50 },
            { equal: ['repoId', ['repo-1', 'repo-2']] },
        ]);
    });
});
