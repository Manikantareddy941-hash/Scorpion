import request from 'supertest';
import express from 'express';

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { COMPLIANCE_CONTROLS: 'compliance_controls' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
    },
}));
jest.mock('../services/complianceEngine', () => ({
    evaluateCompliance: jest.fn(),
}));

import complianceRoutes from './complianceRoutes';
import { databases } from '../lib/appwrite';
import { evaluateCompliance } from '../services/complianceEngine';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
        req.user = { $id: 'user-1' };
        next();
    });
    app.use('/api/compliance', complianceRoutes);
    return app;
};

describe('complianceRoutes', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET / scopes controls to the authenticated user', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ $id: 'c1' }] });

        const res = await request(buildApp()).get('/api/compliance');

        expect(res.statusCode).toBe(200);
        expect(databases.listDocuments).toHaveBeenCalledWith('test-db', 'compliance_controls', [
            { equal: ['scopeId', 'user-1'] },
        ]);
    });

    it('GET / returns 500 if the database call fails', async () => {
        (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('boom'));

        const res = await request(buildApp()).get('/api/compliance');

        expect(res.statusCode).toBe(500);
    });

    it('POST /evaluate runs compliance evaluation for the authenticated user', async () => {
        (evaluateCompliance as jest.Mock).mockResolvedValue([{ controlId: 'c1', status: 'pass' }]);

        const res = await request(buildApp()).post('/api/compliance/evaluate');

        expect(res.statusCode).toBe(200);
        expect(evaluateCompliance).toHaveBeenCalledWith('user-1');
        expect(res.body.results).toEqual([{ controlId: 'c1', status: 'pass' }]);
    });

    it('POST /evaluate returns 500 if evaluation throws', async () => {
        (evaluateCompliance as jest.Mock).mockRejectedValue(new Error('boom'));

        const res = await request(buildApp()).post('/api/compliance/evaluate');

        expect(res.statusCode).toBe(500);
    });
});
