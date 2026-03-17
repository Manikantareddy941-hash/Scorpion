import PDFDocument from 'pdfkit';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

// Heuristic mapping of tool results to OWASP Top 10 categories
const MAP_OWASP = (finding: any) => {
    const msg = (finding.message || '').toLowerCase();
    const tool = finding.tool;

    if (tool === 'gitleaks' || msg.includes('secret') || msg.includes('key') || msg.includes('password')) {
        return 'A02:2021-Cryptographic Failures';
    }
    if (tool === 'trivy' || msg.includes('vulnerability') || msg.includes('cve')) {
        return 'A06:2021-Vulnerable and Outdated Components';
    }
    if (msg.includes('injection') || msg.includes('sql') || msg.includes('xss')) {
        return 'A03:2021-Injection';
    }
    if (msg.includes('access') || msg.includes('auth') || msg.includes('permission')) {
        return 'A01:2021-Broken Access Control';
    }
    if (msg.includes('config') || msg.includes('security headers')) {
        return 'A05:2021-Security Misconfiguration';
    }

    return 'A10:2021-Server-Side Request Forgery'; // Default/Other
};

export const getSecurityPostureStats = async (userId: string, scope: 'global' | 'team' | 'project', id?: string) => {
    try {
        let repoIds: string[] = [];

        if (scope === 'project' && id) {
            repoIds = [id];
        } else if (scope === 'team' && id) {
            const accessDocs = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_ACCESS, [
                Query.equal('team_id', id)
            ]);
            repoIds = accessDocs.documents.map(a => a.repo_id);
        } else {
            // Global scope - Owned + Team Accessed
            const ownedRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
                Query.equal('user_id', userId)
            ]);
            
            repoIds = ownedRepos.documents.map(r => r.$id);

            // Fetch team repos
            const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
                Query.equal('user_id', userId)
            ]);

            if (memberships.total > 0) {
                const teamIds = memberships.documents.map(m => m.team_id);
                const teamAccess = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_ACCESS, [
                    Query.equal('team_id', teamIds)
                ]);
                const teamRepoIds = teamAccess.documents.map(a => a.repo_id);
                repoIds = Array.from(new Set([...repoIds, ...teamRepoIds]));
            }
        }

        if (repoIds.length === 0) return null;

        // Fetch Repo details for risk scores
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('$id', repoIds)
        ]);

        // Aggregate Vulnerabilities
        const vulnsDocs = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('repo_id', repoIds),
            Query.equal('resolution_status', 'open'),
            Query.limit(100) // Adjust limit as needed
        ]);

        const vulns = vulnsDocs.documents;

        const stats = {
            total_repos: repos.total,
            avg_risk_score: Math.round(repos.documents.reduce((acc, r: any) => acc + (r.risk_score || 0), 0) / (repos.total || 1)),
            total_findings: vulnsDocs.total,
            severity_breakdown: {
                critical: vulns.filter((v: any) => v.severity === 'critical').length,
                high: vulns.filter((v: any) => v.severity === 'high').length,
                medium: vulns.filter((v: any) => v.severity === 'medium').length,
                low: vulns.filter((v: any) => v.severity === 'low').length,
            },
            owasp_breakdown: {} as Record<string, number>,
            tool_breakdown: {} as Record<string, number>,
        };

        vulns.forEach((v: any) => {
            const cat = MAP_OWASP(v);
            stats.owasp_breakdown[cat] = (stats.owasp_breakdown[cat] || 0) + 1;
            stats.tool_breakdown[v.tool] = (stats.tool_breakdown[v.tool] || 0) + 1;
        });

        return stats;
    } catch (err) {
        console.error('[Reporting] Error generating stats:', err);
        return null;
    }
};

export const getTrendData = async (userId: string, repoIds: string[]) => {
    try {
        if (repoIds.length === 0) return [];

        const scansDocs = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.equal('status', 'completed'),
            Query.orderAsc('$createdAt'),
            Query.limit(50)
        ]);

        return scansDocs.documents.map(s => {
            const details = typeof s.details === 'string' ? JSON.parse(s.details) : s.details;
            return {
                date: s.$createdAt,
                score: details?.security_score || 0
            };
        });
    } catch (err) {
        console.error('[Reporting] Error getting trend data:', err);
        return [];
    }
};

export const generatePDFReportBuffer = async (reportData: { title: string, stats: any, trend: any[] }): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const buffers: any[] = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Header
        doc.fillColor('#1D4ED8').fontSize(24).text('StackPilot Security Posture Report', { align: 'center' });
        doc.moveDown();
        doc.fillColor('#334155').fontSize(12).text(`Scope: ${reportData.title}`, { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Executive Summary
        doc.rect(50, doc.y, 500, 100).fill('#F8FAFC');
        doc.fillColor('#0F172A').fontSize(16).text('Executive Summary', 60, doc.y - 90);
        doc.fontSize(10).fillColor('#475569');
        doc.text(`Total Repositories Scanned: ${reportData.stats.total_repos}`, 70, doc.y + 10);
        doc.text(`Average Risk Score: ${reportData.stats.avg_risk_score}%`, 70, doc.y + 5);
        doc.text(`Total Open Vulnerabilities: ${reportData.stats.total_findings}`, 70, doc.y + 5);
        doc.moveDown(4);

        // Severity Breakdown
        doc.fontSize(16).fillColor('#0F172A').text('Severity Breakdown');
        doc.fontSize(10).fillColor('#DC2626').text(`Critical: ${reportData.stats.severity_breakdown.critical}`);
        doc.fillColor('#EA580C').text(`High: ${reportData.stats.severity_breakdown.high}`);
        doc.fillColor('#CA8A04').text(`Medium: ${reportData.stats.severity_breakdown.medium}`);
        doc.fillColor('#16A34A').text(`Low: ${reportData.stats.severity_breakdown.low}`);
        doc.moveDown(2);

        // OWASP Top 10 (Mapping)
        doc.fontSize(16).fillColor('#0F172A').text('Compliance Alignment (OWASP Top 10)');
        Object.entries(reportData.stats.owasp_breakdown).forEach(([cat, count]) => {
            doc.fontSize(10).fillColor('#475569').text(`${cat}: ${count} findings`);
        });

        // Footer
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            doc.fontSize(8).text(`Page ${i + 1} of ${range.count}`, 50, 750, { align: 'center' });
        }

        doc.end();
    });
};
