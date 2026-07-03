import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

type MockAuthRequest = Request & { user?: { $id: string } };

jest.mock('../lib/appwrite', () => ({
    databases: { createDocument: jest.fn(), getDocument: jest.fn() },
    DB_ID: 'test-db',
    ID: { unique: () => 'scan-123' },
    COLLECTIONS: { SCANS: 'scans' },
}));
jest.mock('../queues/dastQueue', () => ({
    enqueueDastScan: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
    verifyUser: (req: MockAuthRequest, _res: Response, next: NextFunction) => {
        req.user = { $id: 'user-1' };
        next();
    },
}));
jest.mock('../services/logger', () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import dastRoutes from './dastRoutes';
import { databases } from '../lib/appwrite';
import { enqueueDastScan } from '../queues/dastQueue';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/scan/dast', dastRoutes);
    return app;
};

describe('POST /api/scan/dast/dast', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'scan-123' });
        (enqueueDastScan as jest.Mock).mockResolvedValue({ id: 'dast-scan-123' });
    });

    it('rejects a request without target_url', async () => {
        const res = await request(buildApp()).post('/api/scan/dast/dast').send({});
        expect(res.status).toBe(400);
        expect(enqueueDastScan).not.toHaveBeenCalled();
    });

    it('rejects an unknown scanMode', async () => {
        const res = await request(buildApp())
            .post('/api/scan/dast/dast')
            .send({ target_url: 'https://staging.example.com', scanMode: 'nuke' });
        expect(res.status).toBe(400);
        expect(enqueueDastScan).not.toHaveBeenCalled();
    });

    it('rejects auth without a string bearerToken', async () => {
        const res = await request(buildApp())
            .post('/api/scan/dast/dast')
            .send({ target_url: 'https://staging.example.com', auth: { bearerToken: 123 } });
        expect(res.status).toBe(400);
        expect(enqueueDastScan).not.toHaveBeenCalled();
    });

    it('enqueues a valid scan and returns the scanId (no inline execution)', async () => {
        const res = await request(buildApp())
            .post('/api/scan/dast/dast')
            .send({ target_url: 'https://staging.example.com', scanMode: 'active' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ scanId: 'scan-123', status: 'started' });
        expect(enqueueDastScan).toHaveBeenCalledWith({
            targetUrl: 'https://staging.example.com',
            scanMode: 'active',
            scanId: 'scan-123',
            userId: 'user-1',
            auth: undefined,
        });
    });

    it('passes the bearer token through to the queued job', async () => {
        await request(buildApp())
            .post('/api/scan/dast/dast')
            .send({
                target_url: 'https://staging.example.com',
                auth: { bearerToken: 'tok-abc' },
            });

        expect(enqueueDastScan).toHaveBeenCalledWith(
            expect.objectContaining({ auth: { bearerToken: 'tok-abc' } })
        );
    });
});
