import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

type MockAuthRequest = Request & { user?: { $id: string } };

jest.mock('../lib/appwrite', () => ({
    databases: { createDocument: jest.fn(), getDocument: jest.fn() },
    DB_ID: 'test-db',
    ID: { unique: () => 'scan-123' },
    COLLECTIONS: { SCANS: 'scans' },
}));
jest.mock('../queues/ffufQueue', () => ({
    enqueueFfufScan: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
    verifyUser: (req: MockAuthRequest, _res: Response, next: NextFunction) => {
        req.user = { $id: 'user-1' };
        next();
    },
}));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import ffufRoutes from './ffufRoutes';
import { databases } from '../lib/appwrite';
import { enqueueFfufScan } from '../queues/ffufQueue';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/scan', ffufRoutes);
    return app;
};

describe('POST /api/scan/ffuf', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'scan-123' });
        (enqueueFfufScan as jest.Mock).mockResolvedValue({ id: 'ffuf-scan-123' });
    });

    it('rejects a request without target_url', async () => {
        const res = await request(buildApp()).post('/api/scan/ffuf').send({});
        expect(res.status).toBe(400);
        expect(enqueueFfufScan).not.toHaveBeenCalled();
    });

    it('rejects a non-positive rate', async () => {
        const res = await request(buildApp())
            .post('/api/scan/ffuf')
            .send({ target_url: 'https://staging.example.com', rate: 0 });
        expect(res.status).toBe(400);
        expect(enqueueFfufScan).not.toHaveBeenCalled();
    });

    it('enqueues a valid scan and returns the scanId', async () => {
        const res = await request(buildApp())
            .post('/api/scan/ffuf')
            .send({ target_url: 'https://staging.example.com', rate: 20 });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ scanId: 'scan-123', status: 'started' });
        expect(enqueueFfufScan).toHaveBeenCalledWith({
            targetUrl: 'https://staging.example.com',
            rate: 20,
            scanId: 'scan-123',
            userId: 'user-1',
        });
    });

    it('omits rate when not provided', async () => {
        await request(buildApp())
            .post('/api/scan/ffuf')
            .send({ target_url: 'https://staging.example.com' });

        expect(enqueueFfufScan).toHaveBeenCalledWith(
            expect.objectContaining({ rate: undefined })
        );
    });
});
