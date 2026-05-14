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

        // 3. Get recent scans to map findings that might miss repo_id
        const scansResponse = await databases.listDocuments(
            DB_ID,
            'scans',
            [
                Query.or([
                    Query.equal('repo_id', repoIds),
                    Query.equal('repoUrl', reposResponse.documents.map(r => r.url).filter(Boolean))
                ]),
                Query.orderDesc('$createdAt'),
                Query.limit(50)
            ]
        );
        const scanIds = scansResponse.documents.map(s => s.$id);

        // 4. Get findings for these repos/scans
        // We use OR to find findings either by repo_id OR scanId
        const findingsResponse = await databases.listDocuments(
            DB_ID,
            'findings',
            [
                Query.or([
                    Query.equal('repo_id', repoIds),
                    Query.equal('scanId', scanIds)
                ]),
                Query.limit(5000)
            ]
        );

        const findings = findingsResponse.documents;

        // 5. Aggregate Data
        const stats = {
            total: findingsResponse.total,
            by_severity: { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>,
            by_type: { secret: 0, dependency: 0, sast: 0, docker: 0 } as Record<string, number>,
            by_type_severity: {
                secret: { critical: 0, high: 0, medium: 0, low: 0 },
                dependency: { critical: 0, high: 0, medium: 0, low: 0 },
                sast: { critical: 0, high: 0, medium: 0, low: 0 },
                docker: { critical: 0, high: 0, medium: 0, low: 0 }
            } as Record<string, Record<string, number>>,
            by_repo: [] as { repo_name: string, count: number, repo_id: string }[],
            trend: [] as { date: string, count: number }[],
            open_count: 0,
            resolved_count: 0,
            findings: findings
        };

        const repoCounts: Record<string, number> = {};
        const trendCounts: Record<string, number> = {};

        // Map scanId to repoId for fallback
        const scanToRepo: Record<string, string> = {};
        scansResponse.documents.forEach(s => {
            scanToRepo[s.$id] = s.repo_id || s.repoUrl;
        });

        // Initialize trend for last 30 days
        const now = new Date();
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            trendCounts[dateStr] = 0;
        }

        for (const finding of findings) {
            // Severity normalization
            const severity = (finding.severity || 'low').toLowerCase();
            const normalizedSeverity = severity === 'crit' ? 'critical' : severity;
            
            if (stats.by_severity.hasOwnProperty(normalizedSeverity)) {
                stats.by_severity[normalizedSeverity]++;
            }

            // Type normalization (mapping tools to types)
            let type = (finding.type || 'dependency').toLowerCase();
            const tool = (finding.tool || '').toLowerCase();
            if (tool.includes('gitleaks') || tool.includes('secret')) type = 'secret';
            if (tool.includes('semgrep') || tool.includes('sast')) type = 'sast';
            if (tool.includes('trivy') && finding.title?.includes('image')) type = 'docker';
            if (tool.includes('trivy') && !type) type = 'dependency';

            if (stats.by_type.hasOwnProperty(type)) {
                stats.by_type[type]++;
                
                if (stats.by_type_severity[type]) {
                    stats.by_type_severity[type][normalizedSeverity] = (stats.by_type_severity[type][normalizedSeverity] || 0) + 1;
                }
            }

            // Repo identification (with fallback)
            const repoId = finding.repo_id || scanToRepo[finding.scanId];
            if (repoId) {
                repoCounts[repoId] = (repoCounts[repoId] || 0) + 1;
            }

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
            repo_name: repoNames[id] || (id.includes('/') ? id.split('/').pop()?.replace('.git', '') : 'Unknown'),
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

router.get('/posture-breakdown', verifyUser, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.$id;
        
        const reposResponse = await databases.listDocuments(DB_ID, 'repositories', [Query.equal('user_id', userId)]);
        const repos = reposResponse.documents;
        
        if (repos.length === 0) {
            return res.json({ score: 0, breakdown: [], recommendations: ["Add a repository to begin monitoring."] });
        }

        const repoIds = repos.map(r => r.$id);
        
        const findings = await databases.listDocuments(DB_ID, 'findings', [
            Query.equal('repo_id', repoIds),
            Query.equal('status', 'open'),
            Query.limit(5000)
        ]);

        const critical = findings.documents.filter(f => f.severity === 'critical').length;
        const high = findings.documents.filter(f => f.severity === 'high').length;
        const medium = findings.documents.filter(f => f.severity === 'medium').length;

        const criticalPenalty = critical * 5;
        const highPenalty = high * 2;
        const mediumPenalty = medium * 0.5;
        
        const passCount = repos.filter(r => r.gate_status === 'passed' || r.security_score >= 70).length;
        const passRate = (passCount / repos.length) * 100;
        const gatePenalty = (100 - passRate) * 0.3;

        const totalPenalty = criticalPenalty + highPenalty + mediumPenalty + gatePenalty;
        const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

        const breakdown = [
            { category: 'Critical Vulnerabilities', impact: Math.round(criticalPenalty), count: critical },
            { category: 'High Vulnerabilities', impact: Math.round(highPenalty), count: high },
            { category: 'Medium Vulnerabilities', impact: Math.round(mediumPenalty), count: medium },
            { category: 'CI Gate Compliance', impact: Math.round(gatePenalty), rate: `${Math.round(passRate)}%` }
        ];

        const recommendations = [];
        if (critical > 0) recommendations.push(`Remediate ${critical} critical findings immediately to boost score by ~${Math.round(criticalPenalty)}%.`);
        if (high > 0) recommendations.push(`Address ${high} high severity issues to improve posture by ~${Math.round(highPenalty)}%.`);
        if (passRate < 90) recommendations.push(`Improve CI gate pass rate (currently ${Math.round(passRate)}%) by fixing policy blockers.`);

        res.json({
            score,
            breakdown,
            recommendations: recommendations.slice(0, 3)
        });
    } catch (err: any) {
        console.error('[Posture API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
