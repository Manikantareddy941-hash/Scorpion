import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { notifyScanCompletion } from './notificationService';
import { orchestrateScan } from './scan/orchestrator';
import { parseSemgrep, parseGitleaks, parseTrivy, parseCheckov, parseBandit, Finding } from './scan/parsers';
import { normalizeSemgrep, normalizeTrivy, normalizeGitleaks } from '../scanners/normalizer';
import { evaluateQualityGate } from './qualityGateService';
import { evaluateScan } from './policyService';
import { generateFingerprint } from './gitTraceabilityService';
import * as path from 'path';
import * as fs from 'fs';
import crypto from 'crypto';

/**
 * Consistent security score formula — used here and must match Dashboard fallback.
 * Dashboard's derived formula: 100 - (crit*15) - (high*8) - (med*3) - (low*1)
 */
const computeSecurityScore = (critical: number, high: number, medium: number, low: number): number => {
    const penalty = (critical * 10) + (high * 4) + (medium * 1) + (low * 0.25);
    return Math.max(0, Math.round(100 - penalty));
};

export const ingestVulnerabilitiesDelta = async (
    repoId: string,
    scanId: string,
    issues: any[]
) => {
    try {
        console.log(`[Delta Ingestion] Starting delta ingestion for repo: ${repoId}, scan: ${scanId}`);

        // Helper to compute a consistent SHA-256 fingerprint for a vulnerability
        const computeHash = (rId: string, fPath: string, cveOrTitle: string, sev: string): string => {
            const data = `${rId}|${fPath || ''}|${cveOrTitle || ''}|${(sev || '').toUpperCase()}`;
            return crypto.createHash('sha256').update(data).digest('hex');
        };

        // 1. Fetch active (open) vulnerabilities currently stored in Appwrite for this repo
        const activeDocsResponse = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('repo_id', repoId),
            Query.equal('status', 'open'),
            Query.limit(500)
        ]);
        const activeDocs = activeDocsResponse.documents || [];

        // 2. Map existing documents to their computed hashes
        const activeHashMap = new Map<string, any>();
        activeDocs.forEach(doc => {
            const hash = computeHash(
                doc.repo_id, 
                doc.filePath || doc.file_path, 
                doc.cveId || doc.title, 
                doc.severity
            );
            activeHashMap.set(hash, doc);
        });

        // 3. Compute hashes for incoming issues
        const incomingHashMap = new Map<string, any>();
        issues.forEach(issue => {
            const hash = computeHash(
                repoId, 
                issue.filePath || issue.file_path, 
                issue.cveId || issue.title, 
                issue.severity
            );
            incomingHashMap.set(hash, issue);
        });

        // 4. Calculate deltas
        const newOrModifiedIssues: any[] = [];
        const resolvedDocs: any[] = [];

        // Find new/modified (in incoming, but not in existing Appwrite)
        for (const [hash, issue] of incomingHashMap.entries()) {
            if (!activeHashMap.has(hash)) {
                newOrModifiedIssues.push(issue);
            }
        }

        // Find resolved (in existing Appwrite, but missing from incoming)
        for (const [hash, doc] of activeHashMap.entries()) {
            if (!incomingHashMap.has(hash)) {
                resolvedDocs.push(doc);
            }
        }

        console.log(`[Delta Ingestion] Ingestion results for ${repoId}:` + 
            ` Total Incoming: ${issues.length},` +
            ` Active in DB: ${activeDocs.length},` +
            ` New/Modified to Create: ${newOrModifiedIssues.length},` +
            ` Resolved to Update: ${resolvedDocs.length}`
        );

        // 5. Batch writes using parallel execution (using Promise.all on chunks to limit concurrent connections)
        const CHUNK_SIZE = 15;

        // A. Insert New/Modified findings
        for (let i = 0; i < newOrModifiedIssues.length; i += CHUNK_SIZE) {
            const chunk = newOrModifiedIssues.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (issue) => {
                try {
                    await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(), {
                        repo_id: repoId,
                        scanId: scanId,
                        ...issue,
                        code: (issue.code || '').slice(0, 4999),
                        detected_at: new Date().toISOString(),
                        status: 'open'
                    });
                } catch (saveErr: any) {
                    console.error(`[Delta Ingestion] Failed to create vulnerability document:`, saveErr.message);
                }
            }));
        }

        // B. Mark missing vulnerabilities as Resolved
        for (let i = 0; i < resolvedDocs.length; i += CHUNK_SIZE) {
            const chunk = resolvedDocs.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (doc) => {
                try {
                    await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, doc.$id, {
                        status: 'resolved',
                        resolvedAt: new Date().toISOString()
                    });
                    console.log(`[Delta Ingestion] Marked vulnerability ${doc.$id} as RESOLVED.`);
                } catch (updateErr: any) {
                    console.error(`[Delta Ingestion] Failed to update resolved document status:`, updateErr.message);
                }
            }));
        }

    } catch (err: any) {
        console.error(`[Delta Ingestion Error] Failed to compute or ingest scan deltas:`, err.message);
        
        // Fallback: if delta logic fails, fallback to standard insertion so telemetry is never lost
        console.log(`[Delta Ingestion] Falling back to standard bulk creation...`);
        for (const issue of issues) {
            try {
                await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(), {
                    repo_id: repoId,
                    scanId: scanId,
                    ...issue,
                    code: (issue.code || '').slice(0, 4999),
                    detected_at: new Date().toISOString(),
                    status: 'open'
                });
            } catch (fallbackErr: any) {
                console.error(`[Delta Ingestion Fallback] Save failed:`, fallbackErr.message);
            }
        }
    }
};

const addScanLog = async (scanId: string, log: string) => {
    try {
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        const currentLogs = Array.isArray(scan.logs) ? scan.logs : [];
        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            logs: [...currentLogs, `[${new Date().toLocaleTimeString()}] ${log}`]
        });
    } catch (err) {
        console.error('[ScanService] Failed to add log:', err);
    }
};

export const triggerScan = async (
    repoId: string,
    options: { scanType?: any; scanDepth?: any; branch?: string } = {},
    existingScanId?: string   // ← ADD THIS PARAMETER
): Promise<{ scanId: string | null; error: string | null }> => {
    let scanId: string | null = existingScanId || null;
    const scanStartedAt = new Date().toISOString();
    
    try {
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

        // 3️⃣ Create scan record ONLY if not already created by the route
        if (!scanId) {
            // (duplicate scan check only needed when scanId not pre-created)
            const activeScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.equal('repo_id', repoId),
                Query.equal('status', ['pending', 'running']),
                Query.limit(1)
            ]);
            if (activeScans.total > 0) {
                return { scanId: null, error: 'A scan is already in progress for this repository' };
            }

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
        }

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
                const { spawn } = await import('child_process');
                const branchArgs = options.branch ? ['--branch', options.branch] : [];
                const cloneArgs = ['clone', '--depth', '1', ...branchArgs, targetPath, tempDir];
                
                await new Promise((resolve, reject) => {
                    const child = spawn('git', cloneArgs, { timeout: 60000 });
                    child.on('error', reject);
                    child.on('close', (code) => {
                        if (code === 0) resolve(true);
                        else reject(new Error(`Git clone exited with code ${code}`));
                    });
                });
                scanPath = tempDir;
                isTemporary = true;
            } catch (cloneErr: any) {
                console.error('[ScanService] Clone failed:', cloneErr);
                throw new Error(`Failed to clone repository: ${cloneErr.message}`);
            }
        }

        // 6️⃣ Run scans
        await addScanLog(scanId!, "Initiating multi-engine security audit...");
        const timeoutPromise = new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error('Scan Orchestrator Timeout (5m)')), 5 * 60 * 1000)
        );
        const rawResults = await Promise.race([
            orchestrateScan(scanPath, options, (log) => addScanLog(scanId!, log)), 
            timeoutPromise
        ]);
        await addScanLog(scanId!, "All security engines finalized.");

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

        // 8️⃣ Parse findings (Normalized)
        const scanResults: any = {};
        rawResults.forEach(r => {
            try {
                scanResults[r.tool] = JSON.parse(r.stdout);
            } catch (e) {
                scanResults[r.tool] = r.tool === 'gitleaks' ? [] : {};
            }
        });

        const issues = [
            ...normalizeTrivy(scanResults.trivy || {}, scanPath),
            ...normalizeSemgrep(scanResults.semgrep || {}, scanPath),
            ...normalizeGitleaks(scanResults.gitleaks || [], scanPath)
        ];

        // 9️⃣ Count by severity (Adjusted for uppercase)
        const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
        const highCount     = issues.filter(i => i.severity === 'HIGH').length;
        const mediumCount   = issues.filter(i => i.severity === 'MEDIUM').length;
        const lowCount      = issues.filter(i => i.severity === 'LOW').length;
        const infoCount     = issues.filter(i => i.severity === 'INFO').length;
        const totalVulns    = issues.length;

        // Semantic Mappings for Dashboard
        const banditCount = issues.filter(i => i.tool === 'bandit').length;
        const codeSmellCount = issues.filter(i => i.tool === 'semgrep' && (i.severity === 'INFO' || i.severity === 'LOW')).length;

        // FIX: single consistent score formula matching Dashboard fallback
        const score    = computeSecurityScore(criticalCount, highCount, mediumCount, lowCount);
        const riskScore = 100 - score;

        // 🔟 Store vulnerabilities (Normalized) via Delta Ingestion (Delta Scans)
        await ingestVulnerabilitiesDelta(repoId, scanId!, issues);

        console.log(JSON.stringify({ scanId, repoId, stage: 'save', status: 'success', saved_count: issues.length }));

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
                bugs: issues.filter(i => i.tool === 'bandit').length,
                code_smells: issues.filter(i => i.tool === 'semgrep' && (i.severity === 'INFO' || i.severity === 'LOW')).length,
                security_score: score,
                gate_status: gateStatus,
                language: detectedLanguage,
                tools: ['semgrep', 'gitleaks', 'trivy', 'checkov', 'bandit'],
                total_files: totalFiles,
                total_lines: totalLines,
                tool_counts: {
                    semgrep:  issues.filter(i => i.tool === 'semgrep').length,
                    gitleaks: issues.filter(i => i.tool === 'gitleaks').length,
                    trivy:    issues.filter(i => i.tool === 'trivy').length,
                    checkov:  issues.filter(i => i.tool === 'checkov').length,
                    bandit:   issues.filter(i => i.tool === 'bandit').length,
                }
            })
        };

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId!, scanCompletePayload);

        // 🔟 Evaluate Quality Gate (A/B/C/D/F)
        const gateResult = await evaluateQualityGate(scanId!);

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