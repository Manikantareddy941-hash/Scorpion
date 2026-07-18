import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { getInsightsSummary } from '../services/scanService';
import { resolveOwnershipScope } from '../services/tenancyService';

interface AuthenticatedRequest extends Request<Record<string, string>> {
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
                ? repos.documents.reduce((acc, r) => acc + (r.risk_score || 0), 0) / repos.documents.length
                : 0,
            tasks_pending: tasks.documents.filter((t) => t.status !== 'completed').length,
            critical_vulns: repos.documents.reduce((acc, r) => acc + (r.vulnerability_count || 0), 0)
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

        const allRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal('user_id', userId)]);
        const repoIds = allRepos.documents.map((r) => r.$id);

        const scans = repoIds.length > 0 ? await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.orderDesc('$createdAt'),
            Query.limit(10)
        ]) : { documents: [] as Models.DefaultDocument[] };

        const activities = [
            ...repos.documents.map((r) => ({
                id: r.$id,
                type: 'repo_sync',
                title: 'Repository Synced',
                description: `Repository ${r.name} was updated.`,
                timestamp: r.updated_at
            })),
            ...scans.documents.map((s) => ({
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
        const userId = req.user!.$id;
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal('user_id', userId)]);
        const repoIds = repos.documents.map((r) => r.$id);

        const scans = repoIds.length > 0 ? await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.orderAsc('$createdAt'),
            Query.limit(20)
        ]) : { documents: [] as Models.DefaultDocument[] };

        interface TrendPoint { date: string; score: number; vulnerabilities: number }
        const trends = scans.documents.reduce((acc: TrendPoint[], scan) => {
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

/**
 * Repository ids this caller can reach, or null when they can reach none.
 *
 * Returning null rather than an empty array keeps the difference explicit at
 * the call sites below: an empty `Query.equal('repo_id', [])` is not a filter
 * that matches nothing, so widening it by accident would return every row in
 * the collection.
 */
async function accessibleRepoIds(req: AuthenticatedRequest, userId: string): Promise<string[] | null> {
    const scope = await resolveOwnershipScope(req, userId);
    const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
        Query.equal(scope.field, scope.value),
    ]);
    const ids = repos.documents.map(r => r.$id);
    return ids.length > 0 ? ids : null;
}

// Commit stream for the Code Activity page, which read the commits collection
// straight from the browser with no ownership filter — every commit logged by
// every tenant's webhook, including the file paths flagged as sensitive.
router.get('/commits', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoIds = await accessibleRepoIds(req, req.user!.$id);
        if (!repoIds) return res.json({ total: 0, documents: [] });

        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const results = await databases.listDocuments(DB_ID, COLLECTIONS.COMMITS, [
            Query.equal('repo_id', repoIds),
            Query.orderDesc('timestamp'),
            Query.limit(limit),
        ]);
        res.json(results);
    } catch (error: unknown) {
        next(error);
    }
});

// CI test runs for the Test Results page, previously read unfiltered too.
router.get('/test-runs', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoIds = await accessibleRepoIds(req, req.user!.$id);
        if (!repoIds) return res.json({ total: 0, documents: [] });

        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const results = await databases.listDocuments(DB_ID, COLLECTIONS.TEST_RUNS, [
            Query.equal('repo_id', repoIds),
            Query.orderDesc('$createdAt'),
            Query.limit(limit),
        ]);

        // pass_rate is read by the UI but never written by the ingest path, so
        // it always rendered 0%. Both inputs are stored, so derive it here
        // rather than showing a rate that contradicts the counts beside it.
        const documents = results.documents.map(doc => ({
            ...doc,
            pass_rate: doc.pass_rate ?? (
                Number(doc.total_tests) > 0
                    ? Math.round((Number(doc.passed_tests || 0) / Number(doc.total_tests)) * 100)
                    : 0
            ),
        }));

        res.json({ total: results.total, documents });
    } catch (error: unknown) {
        next(error);
    }
});

export default router;
