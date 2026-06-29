import request from 'supertest';
import express from 'express';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.resetModules() + jest.doMock() per test requires re-`require()`ing modules to pick up fresh mocks; static imports are hoisted and would bypass that. */

jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn() },
    DB_ID: 'test-db',
}));
jest.mock('../utils/toolCheck', () => ({
    checkTool: jest.fn(),
}));
jest.mock('../services/prismaClient', () => ({
    prisma: { $queryRaw: jest.fn() },
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

describe('GET /api/health/ready', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('returns 200 ready when the audit-store SELECT 1 resolves', async () => {
        const { prisma } = require('../services/prismaClient');
        (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

        const healthRoutes = require('./healthRoutes').default;
        const res = await request(buildApp(healthRoutes)).get('/api/health/ready');

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('ready');
    });

    it('returns 503 not_ready with the error message when the DB query rejects', async () => {
        const { prisma } = require('../services/prismaClient');
        (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('connection terminated'));

        const healthRoutes = require('./healthRoutes').default;
        const res = await request(buildApp(healthRoutes)).get('/api/health/ready');

        expect(res.statusCode).toBe(503);
        expect(res.body.status).toBe('not_ready');
        expect(res.body.error).toBe('connection terminated');
    });
});
