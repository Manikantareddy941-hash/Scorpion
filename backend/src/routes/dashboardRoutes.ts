import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query, COLLECTIONS } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';

const router = Router();

// In-memory cache
const dashboardCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 60 seconds

router.get('/security', verifyUser, async (req: Request, res: Response) => {
    const userId = (req as any).user?.$id;
    if (!userId) return res.status(401).json({ error: 'User not found' });

    // Check cache
    const cached = dashboardCache.get(userId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Dashboard] Serving cached data for ${userId}`);
        return res.json(cached.data);
    }

    try {
        // 1. Get user's teams
        const teamMemberships = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.TEAM_MEMBERS,
            [Query.equal('user_id', userId)]
        );
        const teamIds = teamMemberships.documents.map(m => m.team_id);

        // 2. Get user repos (owned or team-shared)
        const reposResponse = await databases.listDocuments(
            DB_ID,
            'repositories',
            teamIds.length > 0 ? [
                Query.or([
                    Query.equal('user_id', userId),
                    Query.equal('team_id', teamIds)
                ])
            ] : [
                Query.equal('user_id', userId)
            ]
        );

        const repoIds = reposResponse.documents.map(r => r.$id);
        const repoNames: Record<string, string> = {};
        reposResponse.documents.forEach(r => repoNames[r.$id] = r.name);

        if (repoIds.length === 0) {
            const emptyData = {
                total: 0,
                by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
                by_type: { secret: 0, dependency: 0, sast: 0, docker: 0 },
                by_repo: [],
                trend: [],
                open_count: 0,
                resolved_count: 0
            };
            return res.json(emptyData);
        }

        // 2. Get findings for these repos
        // Note: Appwrite may have a limit of 100 per page, we might need multiple pages or just a large limit for dashboard
        const findingsResponse = await databases.listDocuments(
            DB_ID,
            'findings',
            [
                Query.equal('repo_id', repoIds),
                Query.limit(5000) // Adjust based on expected volume
            ]
        );

        const findings = findingsResponse.documents;

        // 3. Aggregate Data
        const stats = {
            total: findings.total,
            by_severity: { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>,
            by_type: { secret: 0, dependency: 0, sast: 0, docker: 0 } as Record<string, number>,
            by_type_severity: {
                secret: { critical: 0, high: 0, medium: 0, low: 0 },
                dependency: { critical: 0, high: 0, medium: 0, low: 0 },
                sast: { critical: 0, high: 0, medium: 0, low: 0 },
                docker: { critical: 0, high: 0, medium: 0, low: 0 }
            } as Record<string, Record<string, number>>,
            by_repo: [] as { repo_name: string, count: number }[],
            trend: [] as { date: string, count: number }[],
            open_count: 0,
            resolved_count: 0,
            findings: findings // Include full findings list
        };

        const repoCounts: Record<string, number> = {};
        const trendCounts: Record<string, number> = {};

        // Initialize trend for last 30 days
        const now = new Date();
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            trendCounts[dateStr] = 0;
        }

        for (const finding of findings) {
            // Severity
            const severity = (finding.severity || 'low').toLowerCase();
            if (stats.by_severity.hasOwnProperty(severity)) {
                stats.by_severity[severity]++;
            }

            // Type
            const type = (finding.type || 'dependency').toLowerCase();
            if (stats.by_type.hasOwnProperty(type)) {
                stats.by_type[type]++;
                
                // Detailed breakdown for compliance
                if (stats.by_type_severity[type]) {
                    stats.by_type_severity[type][severity] = (stats.by_type_severity[type][severity] || 0) + 1;
                }
            }

            // Repo
            repoCounts[finding.repo_id] = (repoCounts[finding.repo_id] || 0) + 1;

            // Trend
            const dateStr = finding.$createdAt.split('T')[0];
            if (trendCounts.hasOwnProperty(dateStr)) {
                trendCounts[dateStr]++;
            }

            // Status
            if (finding.status === 'resolved') {
                stats.resolved_count++;
            } else {
                stats.open_count++;
            }
        }

        // Format by_repo
        stats.by_repo = Object.entries(repoCounts).map(([id, count]) => ({
            repo_id: id,
            repo_name: repoNames[id] || 'Unknown',
            count
        }));

        // Format trend
        stats.trend = Object.entries(trendCounts).map(([date, count]) => ({
            date,
            count
        })).sort((a, b) => a.date.localeCompare(b.date));

        // Save to cache
        dashboardCache.set(userId, { data: stats, timestamp: Date.now() });

        res.json(stats);

    } catch (err: any) {
        console.error('[Dashboard API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
