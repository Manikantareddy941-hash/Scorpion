import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { getInsightsSummary } from '../services/scanService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

router.get('/summary', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const summary = await getInsightsSummary(req.user!.$id);
        res.json(summary);
    } catch (error: unknown) {
        next(error);
    }
});

// Get dashboard stats
router.get('/dashboard/stats', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id;

        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId)
        ]);

        const tasks = await databases.listDocuments(DB_ID, COLLECTIONS.TASKS, [
            Query.equal('user_id', userId)
        ]);

        const stats = {
            total_repos: repos.total,
            avg_risk_score: repos.documents.length > 0
                ? repos.documents.reduce((acc, r: any) => acc + (r.risk_score || 0), 0) / repos.documents.length
                : 0,
            tasks_pending: tasks.documents.filter((t: any) => t.status !== 'completed').length,
            critical_vulns: repos.documents.reduce((acc, r: any) => acc + (r.vulnerability_count || 0), 0)
        };

        res.json(stats);
    } catch (error: unknown) {
        next(error);
    }
});

// Activity Feed Endpoint
router.get('/dashboard/activities', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id;

        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId),
            Query.orderDesc('updated_at'),
            Query.limit(5)
        ]);

        const scans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.orderDesc('$createdAt'),
            Query.limit(10)
        ]);

        const activities = [
            ...repos.documents.map((r: any) => ({
                id: r.$id,
                type: 'repo_sync',
                title: 'Repository Synced',
                description: `Repository ${r.name} was updated.`,
                timestamp: r.updated_at
            })),
            ...scans.documents.map((s: any) => ({
                id: s.$id,
                type: 'scan_complete',
                title: 'Scan Completed',
                description: `Scan for repo ${s.repo_id} finished with score ${s.details?.security_score || 'N/A'}.`,
                timestamp: s.$createdAt
            }))
        ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        res.json(activities.slice(0, 10));
    } catch (error: unknown) {
        next(error);
    }
});

// Trend Data Endpoint
router.get('/dashboard/trends', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const scans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.orderAsc('$createdAt'),
            Query.limit(20)
        ]);

        const trends = scans.documents.reduce((acc: any[], scan: any) => {
            const date = new Date(scan.$createdAt).toLocaleDateString();
            const score = scan.details?.security_score || 0;
            const vulns = scan.details?.total_vulnerabilities || 0;

            const existing = acc.find(t => t.date === date);
            if (existing) {
                existing.score = (existing.score + score) / 2;
                existing.vulnerabilities += vulns;
            } else {
                acc.push({ date, score, vulnerabilities: vulns });
            }
            return acc;
        }, []);

        res.json(trends);
    } catch (error: unknown) {
        next(error);
    }
});

export default router;
