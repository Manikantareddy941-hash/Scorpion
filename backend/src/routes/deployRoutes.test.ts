import request from 'supertest';
import express, { Request } from 'express';

type MockAuthRequest = Request & { user?: { $id: string; email?: string } };

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        getDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { DEPLOYMENTS: 'deployments', BUILD_PIPELINES: 'build_pipelines', REPOSITORIES: 'repositories' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        orderDesc: (field: string) => ({ orderDesc: field }),
        limit: (n: number) => ({ limit: n }),
    },
}));
jest.mock('../deploy/deployService', () => ({
    triggerDeploy: jest.fn(),
    rollbackDeploy: jest.fn(),
}));

import deployRoutes from './deployRoutes';
import { databases } from '../lib/appwrite';
import { triggerDeploy, rollbackDeploy } from '../deploy/deployService';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: MockAuthRequest, _res, next) => {
        req.user = { $id: 'user-1', email: 'user1@example.com' };
        next();
    });
    app.use('/api/deployments', deployRoutes);
    return app;
};

describe('deployRoutes ownership checks', () => {
    beforeEach(() => jest.clearAllMocks());

    it('POST /trigger rejects deploying a build whose repo the caller cannot access', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'build-1', repoId: 'repo-1' }) // build doc
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'someone-else' }); // repo doc

        const res = await request(buildApp())
            .post('/api/deployments/trigger')
            .send({ buildId: 'build-1', environment: 'production' });

        expect(res.statusCode).toBe(403);
        expect(triggerDeploy).not.toHaveBeenCalled();
    });

    it('POST /trigger deploys when the caller owns the build\'s repo', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'build-1', repoId: 'repo-1' }) // build doc (route handler)
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'user-1' }) // repo doc (assertRepoAccess)
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'user-1' }); // repo doc again (hasPermission's ownership check)
        (triggerDeploy as jest.Mock).mockResolvedValue({ deploymentId: 'deploy-1', status: 'pending' });

        const res = await request(buildApp())
            .post('/api/deployments/trigger')
            .send({ buildId: 'build-1', environment: 'production' });

        expect(res.statusCode).toBe(202);
        expect(res.body.deploymentId).toBe('deploy-1');
    });

    it('GET /:id rejects fetching a deployment whose repo the caller cannot access', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'deploy-1', repoId: 'repo-1' })
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'someone-else' });

        const res = await request(buildApp()).get('/api/deployments/deploy-1');

        expect(res.statusCode).toBe(403);
    });

    it('GET /:id/status returns the deployment when the caller owns its repo', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'deploy-1', repoId: 'repo-1', status: 'success' })
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'user-1' });

        const res = await request(buildApp()).get('/api/deployments/deploy-1/status');

        expect(res.statusCode).toBe(200);
        expect(res.body.$id).toBe('deploy-1');
    });

    it('POST /:id/rollback rejects rolling back a deployment whose repo the caller cannot access', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'deploy-1', repoId: 'repo-1', status: 'success' })
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'someone-else' });

        const res = await request(buildApp()).post('/api/deployments/deploy-1/rollback');

        expect(res.statusCode).toBe(403);
        expect(rollbackDeploy).not.toHaveBeenCalled();
    });

    it('POST /:id/rollback rolls back when the caller owns the deployment\'s repo', async () => {
        (databases.getDocument as jest.Mock)
            .mockResolvedValueOnce({ $id: 'deploy-1', repoId: 'repo-1', status: 'success' })
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'user-1' })
            .mockResolvedValueOnce({ $id: 'repo-1', user_id: 'user-1' });
        (rollbackDeploy as jest.Mock).mockResolvedValue({ deploymentId: 'deploy-2', status: 'success' });

        const res = await request(buildApp()).post('/api/deployments/deploy-1/rollback');

        expect(res.statusCode).toBe(200);
        expect(rollbackDeploy).toHaveBeenCalledWith('deploy-1');
    });

    it('GET / scopes the unfiltered list to the caller\'s accessible repos', async () => {
        (databases.listDocuments as jest.Mock)
            .mockResolvedValueOnce({ documents: [{ $id: 'repo-1' }] })
            .mockResolvedValueOnce({ documents: [{ $id: 'deploy-1' }] });

        const res = await request(buildApp()).get('/api/deployments');

        expect(res.statusCode).toBe(200);
        expect(databases.listDocuments).toHaveBeenLastCalledWith('test-db', 'deployments', [
            { orderDesc: '$createdAt' },
            { limit: 50 },
            { equal: ['repoId', ['repo-1']] },
        ]);
    });

    it('GET /environments returns the static environment list', async () => {
        const res = await request(buildApp()).get('/api/deployments/environments');

        expect(res.statusCode).toBe(200);
        expect(res.body.environments).toEqual(['dev', 'staging', 'production']);
    });
});
