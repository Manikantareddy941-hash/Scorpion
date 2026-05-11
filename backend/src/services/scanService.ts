import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { notifyScanCompletion } from './notificationService';
import { orchestrateScan } from './scan/orchestrator';
import { parseSemgrep, parseGitleaks, parseTrivy, parseCheckov, parseBandit, Finding } from './scan/parsers';
import { evaluateScan } from './policyService';
import { generateFingerprint } from './gitTraceabilityService';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Consistent security score formula — used here and must match Dashboard fallback.
 * Dashboard's derived formula: 100 - (crit*15) - (high*8) - (med*3) - (low*1)
 */
const computeSecurityScore = (critical: number, high: number, medium: number, low: number): number => {
    const penalty = (critical * 10) + (high * 4) + (medium * 1) + (low * 0.25);
    return Math.max(0, Math.round(100 - penalty));
};

export const triggerScan = async (
    repoId: string,
    options: { scanType?: any; scanDepth?: any; branch?: string } = {}
): Promise<{ scanId: string | null; error: string | null }> => {
    let scanId: string | null = null;
    const scanStartedAt = new Date().toISOString();
    
    try {
        // Pre-check: Duplicate Scan Prevention
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
        if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
        const activeScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoId),
            Query.equal('status', ['pending', 'running']),
            Query.limit(1)
        ]);
        if (activeScans.total > 0) {
            return { scanId: null, error: 'A scan is already in progress for this repository' };
        }

        // 1️⃣ Validate repo
        if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);

        if (!repo)       return { scanId: null, error: 'Repository not found' };
        if (!repo.url)   return { scanId: null, error: 'Repository URL missing' };

        // 2️⃣ Determine target
        let targetPath = repo.url;
        if (repo.url.startsWith('upload://')) {
            targetPath = repo.local_path;
            if (!targetPath) return { scanId: null, error: 'Local path missing' };
        }

        // 3️⃣ Create scan record (status: pending)
        const scan = await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
            repo_id: repoId,
            status: 'pending',
            scan_type: options.scanType || 'full',
            repoUrl: repo.url,
            startedAt: scanStartedAt,
            timestamp: scanStartedAt,
            scannerVersion: '1.0.0',
            visibility: 'public',
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            details: JSON.stringify({
                started_at: scanStartedAt,
                target: targetPath,
                branch: options.branch || 'main',
                depth: options.scanDepth || 'standard'
            })
        });
        scanId = scan.$id;

        // 4️⃣ Update to running
        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId!, { status: 'running' });

        // Update repo cooldown immediately
        await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
            last_scan_at: new Date().toISOString()
        });

        // 5️⃣ Clone if remote
        let scanPath = targetPath;
        let isTemporary = false;

        if (targetPath.startsWith('http')) {
            console.log('[ScanService] Cloning remote repo:', targetPath, 'Branch:', options.branch || 'main');
            const tempDir = path.join(process.cwd(), 'tmp', `repo_${scanId}`);
            if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
                fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
            }
            try {
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);
                const branchFlag = options.branch ? `--branch "${options.branch}"` : '';
                await execAsync(`git clone --depth 1 ${branchFlag} "${targetPath}" "${tempDir}"`, { timeout: 60000 });
                scanPath = tempDir;
                isTemporary = true;
            } catch (cloneErr: any) {
                console.error('[ScanService] Clone failed:', cloneErr);
                throw new Error(`Failed to clone repository: ${cloneErr.message}`);
            }
        }

        // 6️⃣ Run scans
        const timeoutPromise = new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error('Scan Orchestrator Timeout (5m)')), 5 * 60 * 1000)
        );
        const rawResults = await Promise.race([orchestrateScan(scanPath, options), timeoutPromise]);

        // 7️⃣ Walk repo for file/line stats
        const languageCounts: Record<string, number> = {};
        const extensionMap: Record<string, string> = {
            '.java': 'Java', '.ts': 'TypeScript', '.tsx': 'TypeScript',
            '.js': 'JavaScript', '.py': 'Python', '.go': 'Go',
            '.cpp': 'C++', '.cs': 'C#'
        };
        let totalLines = 0;
        let totalFiles = 0;

        const walkSync = (dir: string) => {
            try {
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    const fullPath = path.join(dir, file);
                    try {
                        if (fs.statSync(fullPath).isDirectory()) {
                            if (file !== '.git' && file !== 'node_modules') walkSync(fullPath);
                        } else {
                            totalFiles++;
                            const ext = path.extname(file).toLowerCase();
                            try {
                                const content = fs.readFileSync(fullPath, 'utf-8');
                                totalLines += content.split('\n').length;
                            } catch {}
                            if (extensionMap[ext]) {
                                const lang = extensionMap[ext];
                                languageCounts[lang] = (languageCounts[lang] || 0) + 1;
                            }
                        }
                    } catch {}
                });
            } catch {}
        };
        walkSync(scanPath);
        const detectedLanguage = Object.entries(languageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

        console.log(`[STRICT DEBUG] Raw Scan Output Lengths: Semgrep: ${rawResults.find(r => r.tool === 'semgrep')?.stdout.length || 0}, Gitleaks: ${rawResults.find(r => r.tool === 'gitleaks')?.stdout.length || 0}, Trivy: ${rawResults.find(r => r.tool === 'trivy')?.stdout.length || 0}, Checkov: ${rawResults.find(r => r.tool === 'checkov')?.stdout.length || 0}, Bandit: ${rawResults.find(r => r.tool === 'bandit')?.stdout.length || 0}`);

        // 8️⃣ Parse findings
        const findings: Finding[] = [];
        rawResults.forEach(res => {
            if (res.tool === 'semgrep')   findings.push(...parseSemgrep(res.stdout));
            if (res.tool === 'gitleaks')  findings.push(...parseGitleaks(res.stdout));
            if (res.tool === 'trivy')     findings.push(...parseTrivy(res.stdout));
            if (res.tool === 'checkov')   findings.push(...parseCheckov(res.stdout));
            if (res.tool === 'bandit')    findings.push(...parseBandit(res.stdout));
        });

        console.log(`[STRICT DEBUG] Total Parsed Vulnerabilities: ${findings.length}`);

        // 9️⃣ Count by severity
        const criticalCount = findings.filter(f => f.severity === 'critical').length;
        const highCount     = findings.filter(f => f.severity === 'high').length;
        const mediumCount   = findings.filter(f => f.severity === 'medium').length;
        const lowCount      = findings.filter(f => f.severity === 'low').length;
        const infoCount     = findings.filter(f => f.severity === 'info').length;
        const totalVulns    = findings.length;

        // Semantic Mappings for Dashboard
        const banditCount = findings.filter(f => f.tool === 'bandit').length;
        const codeSmellCount = findings.filter(f => f.tool === 'semgrep' && (f.severity === 'info' || f.severity === 'low')).length;

        // FIX: single consistent score formula matching Dashboard fallback
        const score    = computeSecurityScore(criticalCount, highCount, mediumCount, lowCount);
        const riskScore = 100 - score;

        // 🔟 Store vulnerabilities
        const savedFindings: any[] = [];
        if (findings.length > 0) {
            for (const f of findings) {
                try {
                    const safeTool       = (f.tool       || 'unknown').substring(0, 50);
                    const safeSeverity   = (f.severity   || 'low').substring(0, 50);
                    const safeMessage    = (f.message    || '').substring(0, 4000);
                    const safeFile       = (f.file_path  || '').substring(0, 2000);
                    const safePackage    = (f.package    || '').substring(0, 255);
                    const safeVersion    = (f.version    || '').substring(0, 255);
                    const safeFixVersion = (f.fixVersion || '').substring(0, 255);

                    let safeLine = parseInt(f.line_number as any, 10);
                    if (isNaN(safeLine)) safeLine = 0;

                    const rawFingerprint = generateFingerprint({ tool: safeTool, file_path: safeFile, message: safeMessage });
                    const safeFingerprint = rawFingerprint.substring(0, 255);

                    if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
                    const doc = await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(), {
                        repo_id: repoId,
                        scanId: scanId,
                        scan_result_id: scanId,
                        tool: safeTool,
                        severity: safeSeverity,
                        message: safeMessage,
                        file_path: safeFile,
                        line_number: safeLine,
                        package: safePackage,
                        version: safeVersion,
                        fixVersion: safeFixVersion,
                        status: 'open',
                        resolution_status: 'open',
                        fingerprint: safeFingerprint,
                        detected_at: new Date().toISOString(),
                        cvss_score: f.cvss_score ?? null
                    });
                    savedFindings.push(doc);
                } catch (saveError: any) {
                    console.error(`[STRICT DEBUG] Failed to save vulnerability record:`, saveError?.response || saveError);
                }
            }
        }

        console.log(JSON.stringify({ scanId, repoId, stage: 'save', status: 'success', saved_count: savedFindings.length }));

        // 1️⃣1️⃣ Evaluate policy gate BEFORE writing completed details
        let gateStatus: 'passed' | 'failed' = score >= 50 ? 'passed' : 'failed';
        try {
            const policyResult = await evaluateScan(scanId!);
            if (policyResult?.result) {
                gateStatus = (policyResult.result === 'PASS' || policyResult.result === 'WARN') ? 'passed' : 'failed';
            }
        } catch (policyErr) {
            console.error('[ScanService] Policy evaluation error:', policyErr);
        }

        // 1️⃣2️⃣ Finalize scan record
        const completedAt = new Date().toISOString();
        const scanCompletePayload = {
            status: 'completed',
            completedAt,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            details: JSON.stringify({
                completed_at: completedAt,
                started_at: scanStartedAt,
                critical_count: criticalCount,
                high_count: highCount,
                medium_count: mediumCount,
                low_count: lowCount,
                info_count: infoCount,
                total_vulnerabilities: totalVulns,
                bugs: findings.filter(f => f.tool === 'bandit').length,
                code_smells: findings.filter(f => f.tool === 'semgrep' && (f.severity === 'info' || f.severity === 'low')).length,
                security_score: score,
                gate_status: gateStatus,
                language: detectedLanguage,
                tools: ['semgrep', 'gitleaks', 'trivy', 'checkov', 'bandit'],
                total_files: totalFiles,
                total_lines: totalLines,
                tool_counts: {
                    semgrep:  findings.filter(f => f.tool === 'semgrep').length,
                    gitleaks: findings.filter(f => f.tool === 'gitleaks').length,
                    trivy:    findings.filter(f => f.tool === 'trivy').length,
                    checkov:  findings.filter(f => f.tool === 'checkov').length,
                    bandit:   findings.filter(f => f.tool === 'bandit').length,
                }
            })
        };

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId!, scanCompletePayload);

        // Update repo document with security_score for dashboard fallbacks
        await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
            last_scan_at: completedAt,
            vulnerability_count: totalVulns,
            risk_score: riskScore,
            security_score: score,
            updated_at: completedAt
        });

        // 🧹 Cleanup
        if (isTemporary && fs.existsSync(scanPath)) {
            fs.rmSync(scanPath, { recursive: true, force: true });
        }

        await notifyScanCompletion(scanId!);
        return { scanId, error: null };

    } catch (err: any) {
        console.error(JSON.stringify({ scanId, repoId, stage: 'fail', error: err.message }));
        if (scanId) {
            try {
                await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
                    status: 'failed',
                    completedAt: new Date().toISOString(),
                    details: JSON.stringify({
                        error: err.message,
                        security_score: 0,
                        gate_status: 'failed',
                        critical_count: 0,
                        high_count: 0,
                        medium_count: 0,
                        low_count: 0,
                        total_vulnerabilities: 0,
                        total_lines: 0
                    })
                });
            } catch (uErr) {}
        }
        return { scanId, error: err.message || 'Failed to complete scan' };
    }
};

export const getInsightsSummary = async (userId: string) => {
    try {
        if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
        const reposDocs = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId),
            Query.orderDesc('last_scan_at')
        ]);
        const repos = reposDocs.documents;
        if (repos.length === 0) return { repos: [], scans: [], overallScore: 0, totalVulns: 0 };

        const repoIds = repos.map(r => r.$id);
        if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
        const scansDocs = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.equal('status', 'completed'),
            Query.orderDesc('startedAt'),
            Query.limit(10)
        ]);
        const scans = scansDocs.documents.map(s => ({
            ...s,
            details: typeof s.details === 'string' ? JSON.parse(s.details) : s.details
        }));
        const totalVulns = repos.reduce((acc: number, r: any) => acc + (r.vulnerability_count || 0), 0);
        const overallScore = scans.length > 0 ? (scans[0].details?.security_score || 0) : 0;
        return { repos, scans, overallScore, totalVulns };
    } catch (err) {
        console.error('[ScanService] Error getting insights summary:', err);
        return { repos: [], scans: [], overallScore: 0, totalVulns: 0 };
    }
};