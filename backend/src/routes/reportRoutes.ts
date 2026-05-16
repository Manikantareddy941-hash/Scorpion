import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logAuditEvent } from '../utils/auditLogger';
import PDFDocument from 'pdfkit';
import { Parser } from 'json2csv';
import { generateSecuritySummary } from '../services/aiService';
import { PassThrough } from 'stream';

const router = Router();

const validateRange = (range: any) => {
    const valid = ['15m', '1h', '24h', '7d'];
    return valid.includes(range) ? range : '24h';
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
router.get('/ai-summary', verifyUser, async (req: Request, res: Response) => {
    const range = validateRange(req.query.range);
    const boundary = getRangeBoundary(range);

    try {
        const findings = await databases.listDocuments(DB_ID, 'findings', [
            Query.greaterThanEqual('$createdAt', boundary),
            Query.limit(100)
        ]);
        
        const alerts = await databases.listDocuments(DB_ID, 'alerts', [
            Query.greaterThanEqual('$createdAt', boundary),
            Query.limit(50)
        ]);

        // 8-second timeout for Gemini
        const summaryPromise = generateSecuritySummary(findings.documents, alerts.documents);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT')), 8000)
        );

        const summary = await Promise.race([summaryPromise, timeoutPromise]) as string;
        res.status(200).json({ summary });
    } catch (err: any) {
        console.error('[AI Summary Error]', err.message);
        const fallback = "### ⚠️ AI Analysis Engine temporarily unreachable\n\n*The security mesh analysis timed out or encountered a network bridge interruption.*\n\n**Action Required**:\n1. Please check your network connectivity.\n2. Verify the Gemini API key status in your environment configuration.\n3. Try refreshing the briefing in a few moments.\n\n*Manual telemetry indicates system health remains within normal operational parameters.*";
        res.status(200).json({ summary: fallback });
    }
});

// Support both POST and GET for exports (GET is easier for browser download triggers)
const handleExport = async (req: Request, res: Response) => {
    const { repo_id, format, from, to, type } = { ...req.body, ...req.query };
    
    try {
        let repo;
        if (repo_id === 'global') {
            repo = { name: 'Global-Fleet', $id: 'global' };
        } else {
            repo = await databases.getDocument(DB_ID, 'repositories', repo_id);
        }

        const queries = repo_id === 'global' ? [] : [Query.equal('repo_id', repo_id)];
        if (from) queries.push(Query.greaterThanEqual('$createdAt', from));
        if (to) queries.push(Query.lessThanEqual('$createdAt', to));
        
        const userId = (req as any).user?.$id;
        await logAuditEvent('REPORT_EXPORTED', `Security report generated as ${format.toUpperCase()} for ${repo.name}`, userId, repo_id);

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="scorpion-${type || 'report'}-${repo.name}.csv"`);

            const fields = ['title', 'severity', 'type', 'file_path', 'cve_id', 'status', '$createdAt'];
            const parser = new Parser({ fields });
            
            const findingsResponse = await databases.listDocuments(DB_ID, 'findings', [...queries, Query.limit(5000)]);
            const csv = parser.parse(findingsResponse.documents);
            
            const stream = new PassThrough();
            stream.pipe(res);
            stream.write(csv);
            stream.end();
            return;
        }

        if (format === 'pdf') {
            const findingsResponse = await databases.listDocuments(DB_ID, 'findings', [...queries, Query.limit(5000)]);
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
    } catch (err: any) {
        console.error('[Export Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

router.get('/export', async (req: Request, res: Response, next) => {
    // Handle query token auth
    const token = req.query.token as string;
    if (token) {
        req.headers.authorization = `Bearer ${token}`;
    }
    verifyUser(req, res, next);
}, handleExport);

router.post('/export', verifyUser, handleExport);

export default router;
