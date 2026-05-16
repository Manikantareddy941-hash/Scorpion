import { Router, Response, Request } from 'express';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { telemetryBuffer } from '../services/metrics';

const router = Router();

router.get('/', verifyUser, async (req: Request, res: Response) => {
    try {
        // 1. Validation & Range Calculation
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

        // 2. Fetch Data from Appwrite
        const [reposRes, scansRes, notifsRes] = await Promise.all([
            databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.limit(50)]),
            databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.greaterThanEqual('$createdAt', startTime.toISOString()),
                Query.orderDesc('$createdAt'),
                Query.limit(100)
            ]),
            databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATIONS, [
                Query.greaterThanEqual('$createdAt', startTime.toISOString()),
                Query.orderDesc('$createdAt'),
                Query.limit(50)
            ])
        ]);

        // 3. Aggregate Infrastructure Health (from Buffer)
        const infraHistory = telemetryBuffer
            .filter(point => point.timestamp >= startTime.getTime())
            .map(point => ({
                name: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                cpu: point.cpu,
                mem: point.mem
            }));

        // 4. Aggregate Security Events
        // Group by time slots for the chart
        const securityEvents = scansRes.documents.map(s => ({
            name: new Date(s.$createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            alerts: s.vulnerabilities || 0,
            blocked: (s.gateStatus === 'failed' || s.gateStatus === 'blocked') ? 1 : 0,
            failures: s.status === 'failed' ? 1 : 0
        })).reverse();

        // 5. Fleet Health
        const fleet = reposRes.documents.map(repo => {
            const latestScan = scansRes.documents.find(s => s.repo_id === repo.$id || s.repoUrl === repo.url);
            const vulns = Number(latestScan?.vulnerabilities || 0);
            return {
                id: repo.$id,
                name: repo.name || repo.url?.split('/').pop()?.replace('.git', '') || 'Unknown',
                lastScan: latestScan?.$createdAt,
                status: latestScan?.status || 'idle',
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
            metrics: {
                success_rate: scansRes.total > 0 ? Math.round((scansRes.documents.filter(s => s.gateStatus === 'passed').length / scansRes.total) * 100) : 0,
                avg_duration: scansRes.total > 0 ? Math.round(scansRes.documents.reduce((acc, s) => acc + (s.duration || 0), 0) / scansRes.total) : 0,
                velocity: 'Stable'
            }
        });
    } catch (err: any) {
        console.error('[Monitor API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
