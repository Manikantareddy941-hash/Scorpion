import request from 'supertest';
import express from 'express';

jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn() },
    DB_ID: 'test-db',
}));
jest.mock('../utils/toolCheck', () => ({
    checkTool: jest.fn(),
}));

const buildApp = (healthRoutes: express.Router) => {
    const app = express();
    app.use('/api', healthRoutes);
    return app;
};

describe('GET /api/health', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('reports appwrite healthy and each tool status when everything is reachable', async () => {
        jest.doMock('../workers/scanWorker', () => ({ isWorkerRunning: true }));
        const { databases } = require('../lib/appwrite');
        const { checkTool } = require('../utils/toolCheck');
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [], total: 0 });
        (checkTool as jest.Mock).mockImplementation((tool: string) => tool !== 'checkov');

        const healthRoutes = require('./healthRoutes').default;
        const res = await request(buildApp(healthRoutes)).get('/api/health');

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.services).toEqual({
            appwrite: true,
            gitleaks: true,
            semgrep: true,
            trivy: true,
            checkov: false,
        });
        expect(res.body.worker).toBe('running');
        expect(databases.listDocuments).toHaveBeenCalledWith('test-db', 'repositories', expect.anything());
    });

    it('reports appwrite as unhealthy without failing the request when the DB call rejects', async () => {
        jest.doMock('../workers/scanWorker', () => ({ isWorkerRunning: false }));
        const { databases } = require('../lib/appwrite');
        const { checkTool } = require('../utils/toolCheck');
        (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('connection refused'));
        (checkTool as jest.Mock).mockReturnValue(false);

        const healthRoutes = require('./healthRoutes').default;
        const res = await request(buildApp(healthRoutes)).get('/api/health');

        expect(res.statusCode).toBe(200);
        expect(res.body.services.appwrite).toBe(false);
        expect(res.body.worker).toBe('stopped');
    });
});
