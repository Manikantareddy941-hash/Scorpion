import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { notifyScanCompletion } from './notificationService';
import { orchestrateScan } from './scan/orchestrator';
import { parseSemgrep, parseGitleaks, parseTrivy, Finding } from './scan/parsers';
import { evaluateScan } from './policyService';
import { generateFingerprint } from './gitTraceabilityService';
import * as path from 'path';
import * as fs from 'fs';

export const triggerScan = async (
    repoId: string,
    visibility: string = 'public'
): Promise<{ scanId: string | null; error: string | null }> => {
    try {
        // 1️⃣ Validate repo
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);

        if (!repo) {
            return { scanId: null, error: 'Repository not found' };
        }

        if (!repo.url) {
            return { scanId: null, error: 'Repository URL missing' };
        }

        // 2️⃣ Determine target
        let targetPath = repo.url;

        if (repo.url.startsWith('upload://')) {
            targetPath = repo.local_path;
            if (!targetPath) return { scanId: null, error: 'Local path missing' };
        }

        // 3️⃣ Cooldown
        if (repo.last_scan_at) {
            const last = new Date(repo.last_scan_at).getTime();
            if (Date.now() - last < 5 * 60 * 1000) {
                return { scanId: null, error: 'Scan cooldown active (5 min)' };
            }
        }

        // 4️⃣ Create scan row
        const scan = await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
            repo_id: repoId,
            status: 'queued',
            scan_type: 'full',
            repoUrl: repo.url,
            visibility: visibility,
            timestamp: new Date().toISOString(),
            scannerVersion: '0.69.3',
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            details: JSON.stringify({
                started_at: new Date().toISOString(),
                target: targetPath
            })
        });

        // 5️⃣ Async execution
        (async () => {
            try {
                await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, {
                    status: 'in_progress'
                });

                // 🟢 Real scan execution
                let scanPath = targetPath;
                let isTemporary = false;

                if (targetPath.startsWith('http')) {
                    console.log('[ScanService] Cloning remote repo:', targetPath);
                    const tempDir = path.join(process.cwd(), 'tmp', `repo_${scan.$id}`);
                    if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
                        fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
                    }
                    
                    try {
                        const { exec } = await import('child_process');
                        const { promisify } = await import('util');
                        const execAsync = promisify(exec);
                        
                        await execAsync(`git clone --depth 1 "${targetPath}" "${tempDir}"`, { timeout: 60000 });
                        scanPath = tempDir;
                        isTemporary = true;
                    } catch (cloneErr: any) {
                        console.error('[ScanService] Clone failed:', cloneErr);
                        throw new Error(`Failed to clone repository: ${cloneErr.message}`);
                    }
                }

                const rawResults = await orchestrateScan(scanPath);

                // Detect primary language
                const languageCounts: Record<string, number> = {};
                const extensionMap: Record<string, string> = {
                    '.java': 'Java',
                    '.ts': 'TypeScript',
                    '.tsx': 'TypeScript',
                    '.js': 'JavaScript',
                    '.py': 'Python',
                    '.go': 'Go',
                    '.cpp': 'C++',
                    '.cs': 'C#'
                };

                const walkSync = (dir: string) => {
                    const files = fs.readdirSync(dir);
                    files.forEach(file => {
                        const fullPath = path.join(dir, file);
                        if (fs.statSync(fullPath).isDirectory()) {
                            if (file !== '.git' && file !== 'node_modules') walkSync(fullPath);
                        } else {
                            const ext = path.extname(file).toLowerCase();
                            if (extensionMap[ext]) {
                                const lang = extensionMap[ext];
                                languageCounts[lang] = (languageCounts[lang] || 0) + 1;
                            }
                        }
                    });
                };

                walkSync(scanPath);
                const detectedLanguage = Object.entries(languageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

                const findings: Finding[] = [];

                rawResults.forEach(res => {
                    if (res.tool === 'semgrep') findings.push(...parseSemgrep(res.stdout));
                    if (res.tool === 'gitleaks') findings.push(...parseGitleaks(res.stdout));
                    if (res.tool === 'trivy') findings.push(...parseTrivy(res.stdout));
                });

                const totalVulns = findings.length;
                const criticalCount = findings.filter(f => f.severity === 'critical').length;
                const highCount = findings.filter(f => f.severity === 'high').length;

                const score = Math.max(
                    0,
                    100 - (criticalCount * 25 + highCount * 10 + (totalVulns - criticalCount - highCount) * 2)
                );

                const riskScore = 100 - score;

                // Store vulnerabilities
                if (findings.length > 0) {
                    for (const f of findings) {
                        await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(), {
                            repo_id: repoId,
                            scan_result_id: scan.$id,
                            tool: f.tool,
                            severity: f.severity,
                            message: f.message,
                            file_path: f.file_path,
                            line_number: f.line_number,
                            status: 'open',
                            resolution_status: 'open',
                            fingerprint: generateFingerprint({
                                tool: f.tool,
                                file_path: f.file_path || 'unknown',
                                message: f.message
                            })
                        });
                    }
                }

                await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, {
                    status: 'completed',
                    details: JSON.stringify({
                        completed_at: new Date().toISOString(),
                        security_score: score,
                        total_vulnerabilities: totalVulns,
                        critical_count: criticalCount,
                        high_count: highCount,
                        language: detectedLanguage,
                        tools: ['semgrep', 'gitleaks', 'trivy']
                    })
                });

                await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
                    last_scan_at: new Date().toISOString(),
                    vulnerability_count: totalVulns,
                    risk_score: riskScore,
                    updated_at: new Date().toISOString()
                });

                // 🧹 Cleanup
                if (isTemporary && fs.existsSync(scanPath)) {
                    fs.rmSync(scanPath, { recursive: true, force: true });
                }

                await notifyScanCompletion(scan.$id);
                await evaluateScan(scan.$id);

                console.log('[ScanService] Scan finished:', repo.name);

            } catch (err: any) {
                console.error('[ScanService] ERROR:', err);

                await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, {
                    status: 'failed',
                    details: JSON.stringify({ error: err.message })
                });
            }
        })();

        return { scanId: scan.$id, error: null };
    } catch (err: any) {
        console.error('[ScanService] Error triggering scan:', err);
        return { scanId: null, error: err.message || 'Failed to trigger scan' };
    }
};

/* =========================================================
   INSIGHTS SUMMARY (required by index.ts)
   ========================================================= */

export const getInsightsSummary = async (userId: string) => {
    try {
        const reposDocs = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId),
            Query.orderDesc('last_scan_at')
        ]);

        const repos = reposDocs.documents;

        if (repos.length === 0) {
            return {
                repos: [],
                scans: [],
                overallScore: 0,
                totalVulns: 0
            };
        }

        const repoIds = repos.map(r => r.$id);

        const scansDocs = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.equal('status', 'completed'),
            Query.orderDesc('$createdAt'),
            Query.limit(10)
        ]);

        const scans = scansDocs.documents.map(s => ({
            ...s,
            details: typeof s.details === 'string' ? JSON.parse(s.details) : s.details
        }));

        const totalVulns = repos.reduce(
            (acc: number, r: any) => acc + (r.vulnerability_count || 0),
            0
        );

        const overallScore =
            scans.length > 0
                ? scans[0].details?.security_score || 0
                : 0;

        return {
            repos,
            scans: scans || [],
            overallScore,
            totalVulns
        };
    } catch (err) {
        console.error('[ScanService] Error getting insights summary:', err);
        throw err;
    }
};