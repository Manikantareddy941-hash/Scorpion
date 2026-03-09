import { databases, COLLECTIONS, DB_ID, Query } from '../lib/appwrite';
import PDFDocument from 'pdfkit';

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
        let repos: any[] = [];

        if (scope === 'project' && id) {
            const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, id);
            repos = [repo];
        } else if (scope === 'team' && id) {
            // Find all projects/repos accessible by this team
            const accessRes = await databases.listDocuments(
                DB_ID,
                'project_access',
                [Query.equal('team_id', id)]
            );
            const repoIds = accessRes.documents.map((a: any) => a.repo_id);
            if (repoIds.length > 0) {
                const reposRes = await databases.listDocuments(
                    DB_ID,
                    COLLECTIONS.REPOSITORIES,
                    [Query.equal('$id', repoIds)]
                );
                repos = reposRes.documents;
            }
        } else {
            // Global scope - for simplicity during migration, fetch owned repos
            const reposRes = await databases.listDocuments(
                DB_ID,
                COLLECTIONS.REPOSITORIES,
                [Query.equal('user_id', userId)]
            );
            repos = reposRes.documents;
        }

        if (repos.length === 0) return null;

        const repoIds = repos.map((r: any) => r.$id);

        // Aggregate Vulnerabilities
        const vulnsRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.VULNERABILITIES,
            [Query.equal('repo_id', repoIds), Query.equal('resolution_status', 'open')]
        );
        const vulns = vulnsRes.documents;

        const stats = {
            total_repos: repos.length,
            avg_risk_score: Math.round(repos.reduce((acc: number, r: any) => acc + (r.risk_score || 0), 0) / repos.length),
            total_findings: vulns.length,
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
    } catch (error) {
        console.error('[ReportingService] Error generating stats:', error);
        return null;
    }
};

export const getTrendData = async (userId: string, repoIds: string[]) => {
    try {
        const scansRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.SCANS,
            [Query.equal('repo_id', repoIds), Query.equal('status', 'completed'), Query.orderAsc('created_at'), Query.limit(50)]
        );

        return scansRes.documents.map((s: any) => {
            const details = JSON.parse(s.details || '{}');
            return {
                date: s.$createdAt,
                score: details.security_score || 0
            };
        });
    } catch (error) {
        console.error('[ReportingService] Error fetching trend data:', error);
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
