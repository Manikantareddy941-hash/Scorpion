import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { telemetryBuffer } from '../services/metrics';
import { resolveOwnershipScope } from '../services/tenancyService';
import { logger, errorContext } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

router.get('/', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const range = (req.query.range as string) || '24h';
        const validRanges = ['15m', '1h', '24h', '7d'];
        const selectedRange = validRanges.includes(range) ? range : '24h';

        const rangeOffsets: Record<string, number> = {
            '15m': 15 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000
        };
        const startTime = new Date(Date.now() - rangeOffsets[selectedRange]);

        const userId = req.user?.$id || '';
        const scope = await resolveOwnershipScope(req, userId);

        // Resolve the caller's own repos first so scans can be scoped to them
        const reposRes = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal(scope.field, scope.value), Query.limit(50)]);
        const repoIds = reposRes.documents.map((r) => r.$id);

        // 1. Fetch telemetry and database data in parallel, scoped to the caller's repos
        const [scansRes, notifsRes, metricsRes, healthChecksRes] = await Promise.all([
            repoIds.length > 0 ? databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.equal('repo_id', repoIds),
                Query.greaterThanEqual('$createdAt', startTime.toISOString()),
                Query.orderDesc('$createdAt'),
                Query.limit(100)
            ]) : Promise.resolve({ documents: [] as Models.DefaultDocument[], total: 0 }),
            databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATIONS, [
                Query.equal('user_id', userId),
                Query.greaterThanEqual('$createdAt', startTime.toISOString()),
                Query.orderDesc('$createdAt'),
                Query.limit(50)
            ]),
            databases.listDocuments(DB_ID, 'metrics', [
                Query.greaterThanEqual('timestamp', startTime.toISOString()),
                Query.orderDesc('timestamp'),
                Query.limit(100)
            ]),
            databases.listDocuments(DB_ID, 'health_checks', [
                Query.greaterThanEqual('timestamp', startTime.toISOString()),
                Query.orderDesc('timestamp'),
                Query.limit(100)
            ])
        ]);

        // 2. Aggregate CPU and Memory stats from either pushed metrics or telemetryBuffer
        let infraHistory = metricsRes.documents.map(m => ({
            name: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            cpu: m.cpu,
            mem: m.memory
        })).reverse();

        if (infraHistory.length === 0) {
            // Fallback to local process/buffer metrics
            infraHistory = telemetryBuffer
                .filter(point => point.timestamp >= startTime.getTime())
                .map(point => ({
                    name: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    cpu: point.cpu,
                    mem: point.mem
                }));
        }

        // 3. Aggregate Uptime history details
        const healthChecks = healthChecksRes.documents.map(h => ({
            timestamp: h.timestamp,
            latency: h.latency,
            status: h.status
        }));

        // 4. Aggregate Security & Scan events
        const securityEvents = scansRes.documents.map(s => ({
            name: new Date(s.$createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            alerts: s.vulnerabilities || 0,
            blocked: (s.gateStatus === 'failed' || s.gateStatus === 'blocked') ? 1 : 0,
            failures: s.status === 'failed' ? 1 : 0
        })).reverse();

        // 5. Build Fleet Health
        const fleet = reposRes.documents.map(repo => {
            const latestScan = scansRes.documents.find(s => s.repo_id === repo.$id || s.repoUrl === repo.url);
            const vulns = Number(latestScan?.vulnerabilities || 0);
            
            // Resolve actual health check status if present
            const repoChecks = healthChecksRes.documents.filter(h => h.repoId === repo.$id);
            const status = repoChecks.length > 0 ? (repoChecks[0].status === 'up' ? 'running' : 'down') : (latestScan?.status || 'idle');
            
            return {
                id: repo.$id,
                name: repo.name || repo.url?.split('/').pop()?.replace('.git', '') || 'Unknown',
                lastScan: latestScan?.$createdAt,
                status,
                vulnerabilities: vulns,
                health: vulns > 20 ? 'Critical' : vulns > 5 ? 'At Risk' : 'Healthy'
            };
        });

        // 6. Findings Stream
        const findings_stream = notifsRes.documents.map(n => ({
            id: n.$id,
            title: n.title,
            message: n.message,
            severity: n.severity || 'info',
            repo: n.repoName || 'System',
            createdAt: n.$createdAt
        }));

        res.json({
            infra_health: infraHistory,
            security_events: securityEvents,
            findings_stream,
            fleet,
            health_checks: healthChecks,
            metrics: {
                success_rate: scansRes.total > 0 ? Math.round((scansRes.documents.filter(s => s.gateStatus === 'passed').length / scansRes.total) * 100) : 0,
                avg_duration: scansRes.total > 0 ? Math.round(scansRes.documents.reduce((acc, s) => acc + (s.duration || 0), 0) / scansRes.total) : 0,
                velocity: 'Stable'
            }
        });
    } catch (err: unknown) {
        logger.error('[Monitor API Error]', errorContext(err));
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
