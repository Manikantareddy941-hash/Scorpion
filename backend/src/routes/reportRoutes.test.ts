import request from 'supertest';
import express from 'express';

jest.mock('../middleware/auth', () => ({
    verifyUser: (req: any, _res: any, next: any) => {
        req.user = { $id: 'user-1' };
        next();
    },
}));
jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn() },
    DB_ID: 'test-db',
    Query: { equal: (field: string, value: unknown) => ({ equal: [field, value] }) },
}));
jest.mock('../utils/auditLogger', () => ({ logAuditEvent: jest.fn() }));
jest.mock('../services/tenancyService', () => ({
    canAccessResource: jest.fn(),
    resolveOwnershipScope: jest.fn(),
}));
jest.mock('../services/reportingService', () => ({
    getSecurityPostureStats: jest.fn(),
    getTrendData: jest.fn(),
    generatePDFReportBuffer: jest.fn(),
}));
jest.mock('../services/aiService', () => ({ generateSecuritySummary: jest.fn() }));

import reportRoutes from './reportRoutes';
import { databases } from '../lib/appwrite';
import { resolveOwnershipScope } from '../services/tenancyService';
import { getSecurityPostureStats, getTrendData, generatePDFReportBuffer } from '../services/reportingService';
import { logAuditEvent } from '../utils/auditLogger';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/reports', reportRoutes);
    return app;
};

describe('GET /api/reports/posture', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns 404 when there are no scanned repositories for the scope', async () => {
        (getSecurityPostureStats as jest.Mock).mockResolvedValue(null);

        const res = await request(buildApp()).get('/api/reports/posture');

        expect(res.statusCode).toBe(404);
        expect(generatePDFReportBuffer).not.toHaveBeenCalled();
    });

    it('generates and returns a PDF for the default (global) scope', async () => {
        const stats = { total_repos: 2, avg_risk_score: 80, total_findings: 3, severity_breakdown: {}, owasp_breakdown: {} };
        (getSecurityPostureStats as jest.Mock).mockResolvedValue(stats);
        (resolveOwnershipScope as jest.Mock).mockResolvedValue({ field: 'user_id', value: 'user-1' });
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ $id: 'repo-1' }, { $id: 'repo-2' }] });
        (getTrendData as jest.Mock).mockResolvedValue([{ date: '2026-01-01', score: 90 }]);
        (generatePDFReportBuffer as jest.Mock).mockResolvedValue(Buffer.from('%PDF-fake'));

        const res = await request(buildApp()).get('/api/reports/posture');

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(getTrendData).toHaveBeenCalledWith('user-1', ['repo-1', 'repo-2']);
        expect(generatePDFReportBuffer).toHaveBeenCalledWith({
            title: 'All accessible repositories',
            stats,
            trend: [{ date: '2026-01-01', score: 90 }],
        });
        expect(logAuditEvent).toHaveBeenCalledWith(
            'REPORT_EXPORTED',
            expect.stringContaining('global'),
            'user-1',
            undefined
        );
    });

    it('scopes directly to the given project id without an extra ownership lookup', async () => {
        const stats = { total_repos: 1, avg_risk_score: 100, total_findings: 0, severity_breakdown: {}, owasp_breakdown: {} };
        (getSecurityPostureStats as jest.Mock).mockResolvedValue(stats);
        (getTrendData as jest.Mock).mockResolvedValue([]);
        (generatePDFReportBuffer as jest.Mock).mockResolvedValue(Buffer.from('%PDF-fake'));

        const res = await request(buildApp()).get('/api/reports/posture?scope=project&id=repo-1');

        expect(res.statusCode).toBe(200);
        expect(getTrendData).toHaveBeenCalledWith('user-1', ['repo-1']);
        expect(resolveOwnershipScope).not.toHaveBeenCalled();
        expect(generatePDFReportBuffer).toHaveBeenCalledWith(expect.objectContaining({ title: 'Project repo-1' }));
    });

    it('returns 500 if report generation throws', async () => {
        (getSecurityPostureStats as jest.Mock).mockRejectedValue(new Error('boom'));

        const res = await request(buildApp()).get('/api/reports/posture');

        expect(res.statusCode).toBe(500);
    });
});
