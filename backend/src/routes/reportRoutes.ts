import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logAuditEvent } from '../utils/auditLogger';
import PDFDocument from 'pdfkit';
import { Parser } from 'json2csv';
import { generateSecuritySummary } from '../services/aiService';
import { canAccessResource, resolveOwnershipScope } from '../services/tenancyService';
import { getSecurityPostureStats, getTrendData, generatePDFReportBuffer } from '../services/reportingService';
import { PassThrough } from 'stream';
import { logger, errorContext } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

const validateRange = (range: unknown) => {
    const valid = ['15m', '1h', '24h', '7d'];
    return typeof range === 'string' && valid.includes(range) ? range : '24h';
};

const getRangeBoundary = (range: string) => {
    const now = new Date();
    switch (range) {
        case '15m': return new Date(now.getTime() - 15 * 60000).toISOString();
        case '1h': return new Date(now.getTime() - 60 * 60000).toISOString();
        case '24h': return new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
        case '7d': return new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
        default: return new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    }
};

// 1. AI Security Briefing Endpoint with Timeout
router.get('/ai-summary', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    const range = validateRange(req.query.range);
    const boundary = getRangeBoundary(range);

    try {
        const userId = req.user?.$id || '';
        const scope = await resolveOwnershipScope(req, userId);
        const ownedRepos = await databases.listDocuments(DB_ID, 'repositories', [Query.equal(scope.field, scope.value)]);
        const repoIds = ownedRepos.documents.map((r) => r.$id);

        // COLLECTIONS.FINDINGS is 'vulnerabilities' — where scans write. The
        // literal 'findings' is a legacy collection nothing populates, so
        // reports built from it were empty or stale.
        const findings = repoIds.length > 0 ? await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [
            Query.equal('repo_id', repoIds),
            Query.greaterThanEqual('$createdAt', boundary),
            Query.limit(100)
        ]) : { documents: [] as Models.DefaultDocument[] };

        const alerts = await databases.listDocuments(DB_ID, 'alerts', [
            Query.greaterThanEqual('$createdAt', boundary),
            Query.limit(50)
        ]);

        // 8-second timeout for Gemini. The timer must be cleared once the race
        // settles - otherwise every request leaves a pending 8s handle behind.
        const summaryPromise = generateSecuritySummary(findings.documents, alerts.documents);
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('TIMEOUT')), 8000);
        });

        try {
            const summary = await Promise.race([summaryPromise, timeoutPromise]) as string;
            res.status(200).json({ summary });
        } finally {
            clearTimeout(timeoutHandle);
        }
    } catch (err: unknown) {
        logger.error('[AI Summary Error]', { event: 'REPORT_AI_SUMMARY_FAILED', ...errorContext(err) });
        const fallback = "### ⚠️ AI Analysis Engine temporarily unreachable\n\n*The security mesh analysis timed out or encountered a network bridge interruption.*\n\n**Action Required**:\n1. Please check your network connectivity.\n2. Verify the Gemini API key status in your environment configuration.\n3. Try refreshing the briefing in a few moments.\n\n*Manual telemetry indicates system health remains within normal operational parameters.*";
        res.status(200).json({ summary: fallback });
    }
});

// Support both POST and GET for exports (GET is easier for browser download triggers)
const handleExport = async (req: AuthenticatedRequest, res: Response) => {
    const { repo_id, format, from, to, type } = { ...req.body, ...req.query };
    const userId = req.user?.$id || '';

    try {
        let repo;
        let queries: string[];
        if (repo_id === 'global') {
            // "Global" export is scoped to the caller's own accessible repos,
            // not literally every user's findings.
            repo = { name: 'My-Fleet', $id: 'global' };
            const scope = await resolveOwnershipScope(req, userId);
            const ownedRepos = await databases.listDocuments(DB_ID, 'repositories', [Query.equal(scope.field, scope.value)]);
            const repoIds = ownedRepos.documents.map((r) => r.$id);
            queries = repoIds.length > 0 ? [Query.equal('repo_id', repoIds)] : [Query.equal('repo_id', '__none__')];
        } else {
            repo = await databases.getDocument(DB_ID, 'repositories', repo_id);
            if (!(await canAccessResource(repo, userId))) {
                return res.status(403).json({ error: 'You do not have access to this repository' });
            }
            queries = [Query.equal('repo_id', repo_id)];
        }

        if (from) queries.push(Query.greaterThanEqual('$createdAt', from));
        if (to) queries.push(Query.lessThanEqual('$createdAt', to));

        await logAuditEvent('REPORT_EXPORTED', `Security report generated as ${format.toUpperCase()} for ${repo.name}`, userId, repo_id);

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="scorpion-${type || 'report'}-${repo.name}.csv"`);

            const fields = ['title', 'severity', 'type', 'file_path', 'cve_id', 'status', '$createdAt'];
            const parser = new Parser({ fields });
            
            const findingsResponse = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [...queries, Query.limit(5000)]);
            const csv = parser.parse(findingsResponse.documents);
            
            const stream = new PassThrough();
            stream.pipe(res);
            stream.write(csv);
            stream.end();
            return;
        }

        if (format === 'pdf') {
            const findingsResponse = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [...queries, Query.limit(5000)]);
            const findings = findingsResponse.documents;
            
            const doc = new PDFDocument({ margin: 50 });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="scorpion-report-${repo.name}.pdf"`);
            doc.pipe(res);

            doc.fontSize(25).text('SCORPION SECURITY REPORT', { align: 'center' });
            doc.moveDown().fontSize(16).text(`Scope: ${repo.name}`);
            doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`);
            doc.moveDown();

            findings.forEach((f, i) => {
                if (doc.y > 700) doc.addPage();
                doc.fontSize(10).font('Helvetica-Bold').text(`${i + 1}. ${f.title}`);
                doc.font('Helvetica').fontSize(8).text(`Severity: ${f.severity.toUpperCase()} | Path: ${f.file_path}`);
                doc.moveDown(0.5);
            });

            doc.end();
            return;
        }

        res.status(400).json({ error: 'Invalid format' });
    } catch (err: unknown) {
        logger.error('[Export Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

router.get('/export', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Handle query token auth
    const token = req.query.token as string;
    if (token) {
        req.headers.authorization = `Bearer ${token}`;
    }
    verifyUser(req, res, next);
}, handleExport);

router.post('/export', verifyUser, handleExport);

// GET /api/reports/posture - PDF security posture report (severity/OWASP
// breakdown + trend), scoped to the caller's own repos/team/project.
router.get('/posture', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.$id || '';
    const scope = (['global', 'team', 'project'].includes(req.query.scope as string) ? req.query.scope : 'global') as 'global' | 'team' | 'project';
    const id = req.query.id as string | undefined;

    try {
        const stats = await getSecurityPostureStats(userId, scope, id);
        if (!stats) {
            return res.status(404).json({ error: 'No scanned repositories found for this scope' });
        }

        let repoIds: string[];
        if (scope === 'project' && id) {
            repoIds = [id];
        } else {
            const ownScope = await resolveOwnershipScope(req, userId);
            const ownedRepos = await databases.listDocuments(DB_ID, 'repositories', [Query.equal(ownScope.field, ownScope.value)]);
            repoIds = ownedRepos.documents.map((r) => r.$id);
        }
        const trend = await getTrendData(userId, repoIds);

        await logAuditEvent('REPORT_EXPORTED', `Security posture PDF report generated (scope: ${scope})`, userId, id);

        const title = scope === 'project' && id ? `Project ${id}` : scope === 'team' && id ? `Team ${id}` : 'All accessible repositories';
        const buffer = await generatePDFReportBuffer({ title, stats, trend });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="scorpion-posture-report.pdf"');
        res.send(buffer);
    } catch (err: unknown) {
        logger.error('[Posture Report Error]', err);
        res.status(500).json({ error: 'Failed to generate posture report' });
    }
});

/**
 * Report history for the calling user.
 *
 * The Reports page kept this list itself, reading and writing
 * `(COLLECTIONS as any).REPORTS` — a key that does not exist on the frontend
 * COLLECTIONS map, so every call passed `undefined` as the collection id and
 * threw. The cast is what hid it from the type checker; the panel has never
 * shown anything. The list query also carried no owner filter, so had the id
 * resolved it would have listed every tenant's reports.
 */
router.get('/history', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const result = await databases.listDocuments(DB_ID, COLLECTIONS.REPORTS, [
            Query.equal('userId', req.user!.$id),
            Query.orderDesc('$createdAt'),
            Query.limit(Math.min(Number(req.query.limit) || 5, 50)),
        ]);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

router.post('/history', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { title, type, repositoryId, data } = req.body ?? {};
        if (!title) return res.status(400).json({ error: 'title is required' });

        // The repository the report covers must be one this caller can reach.
        if (repositoryId) {
            const repo = await databases
                .getDocument(DB_ID, COLLECTIONS.REPOSITORIES, String(repositoryId))
                .catch(() => null);
            if (!repo || !(await canAccessResource(repo, req.user!.$id))) {
                return res.status(404).json({ error: 'Repository not found' });
            }
        }

        const doc = await databases.createDocument(DB_ID, COLLECTIONS.REPORTS, ID.unique(), {
            userId: req.user!.$id,
            // Lengths match the collection's actual attribute sizes, not the
            // ones this route was written against: `title` is a String(255)
            // there, so slicing at 512 let a long repository name through to a
            // write Appwrite then rejected.
            title: String(title).slice(0, 255),
            type: String(type || 'pdf').slice(0, 50),
            repositoryId: repositoryId ? String(repositoryId) : '',
            status: 'completed',
            createdAt: new Date().toISOString(),
            data: typeof data === 'string' ? data.slice(0, 65536) : JSON.stringify(data ?? {}),
        });
        res.status(201).json(doc);
    } catch (err) {
        next(err);
    }
});

export default router;
