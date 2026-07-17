import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

type MockAuthRequest = Request & { user?: { $id: string } };

jest.mock('../middleware/auth', () => ({
    verifyUser: (req: MockAuthRequest, _res: Response, next: NextFunction) => {
        req.user = { $id: 'user-1' };
        next();
    },
}));
jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn() },
    DB_ID: 'test-db',
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        greaterThanEqual: (field: string, value: unknown) => ({ gte: [field, value] }),
        lessThanEqual: (field: string, value: unknown) => ({ lte: [field, value] }),
        limit: (n: number) => ({ limit: n }),
    },
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
import { resolveOwnershipScope, canAccessResource } from '../services/tenancyService';
import { generateSecuritySummary } from '../services/aiService';
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

describe('GET /api/reports/ai-summary', () => {
    beforeEach(() => jest.clearAllMocks());

    const arm = () => {
        (resolveOwnershipScope as jest.Mock).mockResolvedValue({ field: 'user_id', value: 'user-1' });
        (databases.listDocuments as jest.Mock).mockImplementation(async (_d: string, col: string) => {
            if (col === 'repositories') return { documents: [{ $id: 'repo-1' }] };
            if (col === 'findings') return { documents: [{ title: 'RCE', severity: 'high' }] };
            if (col === 'alerts') return { documents: [] };
            return { documents: [] };
        });
    };

    it('returns the AI briefing when the analyzer responds in time', async () => {
        arm();
        (generateSecuritySummary as jest.Mock).mockResolvedValue('## All clear');

        const res = await request(buildApp()).get('/api/reports/ai-summary?range=1h');

        expect(res.statusCode).toBe(200);
        expect(res.body.summary).toBe('## All clear');
    });

    it('serves the fallback briefing when the analyzer fails', async () => {
        arm();
        (generateSecuritySummary as jest.Mock).mockRejectedValue(new Error('quota'));

        const res = await request(buildApp()).get('/api/reports/ai-summary?range=nonsense');

        expect(res.statusCode).toBe(200);
        expect(res.body.summary).toContain('temporarily unreachable');
    });

    it('skips the findings query when the caller owns no repositories', async () => {
        (resolveOwnershipScope as jest.Mock).mockResolvedValue({ field: 'user_id', value: 'user-1' });
        (databases.listDocuments as jest.Mock).mockImplementation(async (_d: string, col: string) => {
            if (col === 'repositories') return { documents: [] };
            if (col === 'alerts') return { documents: [] };
            throw new Error(`unexpected query on ${col}`);
        });
        (generateSecuritySummary as jest.Mock).mockResolvedValue('empty fleet');

        const res = await request(buildApp()).get('/api/reports/ai-summary');

        expect(res.statusCode).toBe(200);
        expect(res.body.summary).toBe('empty fleet');
    });
});

describe('report export', () => {
    beforeEach(() => jest.clearAllMocks());

    const armGlobal = () => {
        (resolveOwnershipScope as jest.Mock).mockResolvedValue({ field: 'user_id', value: 'user-1' });
        (databases.listDocuments as jest.Mock).mockImplementation(async (_d: string, col: string) => {
            if (col === 'repositories') return { documents: [{ $id: 'repo-1' }] };
            if (col === 'findings') return { documents: [{ title: 'RCE', severity: 'high', type: 'sast', file_path: 'a.ts', cve_id: 'CVE-1', status: 'open', $createdAt: '2026-01-01' }] };
            return { documents: [] };
        });
    };

    it('streams a CSV for the global scope via GET with a query token', async () => {
        armGlobal();

        const res = await request(buildApp()).get('/api/reports/export?repo_id=global&format=csv&token=jwt-1');

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.text).toContain('RCE');
        expect(logAuditEvent).toHaveBeenCalledWith('REPORT_EXPORTED', expect.stringContaining('CSV'), 'user-1', 'global');
    });

    it('renders a PDF for a specific accessible repository via POST', async () => {
        (databases as unknown as { getDocument: jest.Mock }).getDocument = jest.fn().mockResolvedValue({ $id: 'repo-1', name: 'api', user_id: 'user-1' });
        (canAccessResource as jest.Mock).mockResolvedValue(true);
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ title: 'RCE', severity: 'high', file_path: 'a.ts' }] });

        const res = await request(buildApp()).post('/api/reports/export').send({ repo_id: 'repo-1', format: 'pdf' });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
    });

    it('refuses exports for repositories the caller cannot access', async () => {
        (databases as unknown as { getDocument: jest.Mock }).getDocument = jest.fn().mockResolvedValue({ $id: 'repo-2', name: 'other', user_id: 'someone-else' });
        (canAccessResource as jest.Mock).mockResolvedValue(false);

        const res = await request(buildApp()).post('/api/reports/export').send({ repo_id: 'repo-2', format: 'csv' });

        expect(res.statusCode).toBe(403);
        expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('rejects unknown formats', async () => {
        armGlobal();

        const res = await request(buildApp()).post('/api/reports/export').send({ repo_id: 'global', format: 'xlsx' });

        expect(res.statusCode).toBe(400);
    });

    it('maps unexpected failures to 500', async () => {
        (databases as unknown as { getDocument: jest.Mock }).getDocument = jest.fn().mockRejectedValue(new Error('db down'));

        const res = await request(buildApp()).post('/api/reports/export').send({ repo_id: 'repo-1', format: 'csv' });

        expect(res.statusCode).toBe(500);
    });
});
