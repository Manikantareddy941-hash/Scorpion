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
jest.mock('../utils/auditLogger', () => ({
    logAuditEvent: jest.fn(),
}));

import complianceRoutes from './complianceRoutes';
import { databases } from '../lib/appwrite';
import { evaluateCompliance } from '../services/complianceEngine';
import { logAuditEvent } from '../utils/auditLogger';

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

    describe('GET /export', () => {
        const sampleControls = [
            { controlId: 'CC6.1', title: 'Logical access controls', framework: 'SOC2', status: 'passing', lastEvaluated: '2026-01-01T00:00:00.000Z', evidence: JSON.stringify(['scan-1', 'scan-2']) },
            { controlId: 'A.12.6.1', title: 'Management of technical vulnerabilities', framework: 'ISO27001', status: 'failing', lastEvaluated: '2026-01-02T00:00:00.000Z', evidence: JSON.stringify(['scan-3']) },
        ];

        it('rejects an unsupported format', async () => {
            const res = await request(buildApp()).get('/api/compliance/export?format=xlsx');
            expect(res.statusCode).toBe(400);
        });

        it('exports a CSV evidence package and audit-logs the export', async () => {
            (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: sampleControls });

            const res = await request(buildApp()).get('/api/compliance/export?format=csv');

            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/csv/);
            expect(res.text).toContain('CC6.1');
            expect(res.text).toContain('scan-1;scan-2');
            expect(logAuditEvent).toHaveBeenCalledWith('COMPLIANCE_EVIDENCE_EXPORTED', expect.stringContaining('CSV'), 'user-1');
        });

        it('exports a PDF evidence package', async () => {
            (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: sampleControls });

            const res = await request(buildApp()).get('/api/compliance/export?format=pdf');

            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toBe('application/pdf');
            expect(res.headers['content-disposition']).toContain('scorpion-compliance-evidence.pdf');
        });

        it('defaults to pdf when no format is given', async () => {
            (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [] });

            const res = await request(buildApp()).get('/api/compliance/export');

            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toBe('application/pdf');
        });

        it('returns 500 if fetching controls fails', async () => {
            (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('boom'));

            const res = await request(buildApp()).get('/api/compliance/export?format=csv');

            expect(res.statusCode).toBe(500);
        });
    });
});
