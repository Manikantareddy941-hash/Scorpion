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
    let scanId: string | null = null;
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
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.REPOSITORIES}`);
        if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
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

        // 4️⃣ Create scan record (status: pending)
        const scanPayload = {
            repo_id: repoId,
            status: 'pending',
            scan_type: 'full',
            repoUrl: repo.url,
            visibility: visibility,
            startedAt: new Date().toISOString(),
            // timestamp: new Date().toISOString(), // Removing redundant timestamp in favor of startedAt
            scannerVersion: '0.69.3',
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            details: JSON.stringify({
                started_at: new Date().toISOString(),
                target: targetPath
            })
        };
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
        console.log(`[DB Payload]`, JSON.stringify(scanPayload, null, 2));
        if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
        const scan = await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), scanPayload);
        scanId = scan.$id;

        console.log(JSON.stringify({
            scanId,
            repoId,
            stage: 'start',
            timestamp: new Date().toISOString(),
            status: 'pending'
        }));

        // 5️⃣ Update to running
        const updatePayload = { status: 'running' };
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
        console.log(`[DB Payload]`, JSON.stringify(updatePayload, null, 2));
        if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId!, updatePayload);

        // 🚨 Immediately update repo cooldown to prevent exact-millisecond concurrent executions
        await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
            last_scan_at: new Date().toISOString()
        });

        // 6️⃣ Real scan execution
        let scanPath = targetPath;
        let isTemporary = false;

        if (targetPath.startsWith('http')) {
            console.log('[ScanService] Cloning remote repo:', targetPath);
            const tempDir = path.join(process.cwd(), 'tmp', `repo_${scanId}`);
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

        // Add Safeguard Timeout (5 minutes max for orchestrator)
        const timeoutPromise = new Promise<any[]>((_, reject) => 
            setTimeout(() => reject(new Error('Scan Orchestrator Timeout (5m)')), 5 * 60 * 1000)
        );
        const rawResults = await Promise.race([orchestrateScan(scanPath), timeoutPromise]);


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

        let totalLines = 0;
        let totalFiles = 0;

        const walkSync = (dir: string) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    if (file !== '.git' && file !== 'node_modules') walkSync(fullPath);
                } else {
                    totalFiles++;
                    const ext = path.extname(file).toLowerCase();
                    
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        totalLines += content.split('\n').length;
                    } catch (e) {}

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

        // Mandatory Log: Parsed results
        console.log(JSON.stringify({
            scanId,
            repoId,
            stage: 'parse',
            timestamp: new Date().toISOString(),
            status: 'success',
            parsed_count: findings.length
        }));

        const totalVulns = findings.length;
        const criticalCount = findings.filter(f => f.severity === 'critical').length;
        const highCount = findings.filter(f => f.severity === 'high').length;

        const score = Math.max(
            0,
            100 - (criticalCount * 25 + highCount * 10 + (totalVulns - criticalCount - highCount) * 2)
        );

        const riskScore = 100 - score;

        // 7️⃣ Store vulnerabilities (strictly with scanId and repoId)
        const savedFindings: any[] = [];
        if (findings.length > 0) {
            for (const f of findings) {
                // Data Validation Layer
                if (!scanId || !repoId || !f.severity || !f.tool) {
                    console.warn(`[ScanService] Skipping invalid finding payload due to missing required fields:`, f);
                    continue;
                }

                const vulnPayload = {
                    repo_id: repoId,
                    scanId: scanId, 
                    tool: f.tool,
                    severity: f.severity,
                    message: f.message,
                    file_path: f.file_path,
                    line_number: f.line_number,
                    package: f.package || null,
                    version: f.version || null,
                    fixVersion: f.fixVersion || null,
                    status: 'open',
                    resolution_status: 'open',
                    fingerprint: generateFingerprint({
                        tool: f.tool,
                        file_path: f.file_path || 'unknown',
                        message: f.message
                    })
                };
                console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
                console.log(`[DB Payload]`, JSON.stringify(vulnPayload, null, 2));
                if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
                const doc = await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(), vulnPayload);
                savedFindings.push(doc);
            }
        }


        // Mandatory Log: Saved DB data
        console.log(JSON.stringify({
            scanId,
            repoId,
            stage: 'save',
            timestamp: new Date().toISOString(),
            status: 'success',
            saved_count: savedFindings.length
        }));

        // 8️⃣ Update scan record (status: completed)
        const scanCompletePayload = {
            status: 'completed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({
                completed_at: new Date().toISOString(),
                security_score: score,
                total_vulnerabilities: totalVulns,
                critical_count: criticalCount,
                high_count: highCount,
                language: detectedLanguage,
                tools: ['semgrep', 'gitleaks', 'trivy'],
                total_files: totalFiles,
                total_lines: totalLines
            })
        };
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
        console.log(`[DB Payload]`, JSON.stringify(scanCompletePayload, null, 2));
        if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId!, scanCompletePayload);

        const repoUpdatePayload = {
            last_scan_at: new Date().toISOString(),
            vulnerability_count: totalVulns,
            risk_score: riskScore,
            updated_at: new Date().toISOString()
        };
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.REPOSITORIES}`);
        console.log(`[DB Payload]`, JSON.stringify(repoUpdatePayload, null, 2));
        if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
        await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, repoUpdatePayload);

        // 🧹 Cleanup
        if (isTemporary && fs.existsSync(scanPath)) {
            fs.rmSync(scanPath, { recursive: true, force: true });
        }

        await notifyScanCompletion(scanId!);
        await evaluateScan(scanId!);

        console.log(JSON.stringify({
            scanId,
            repoId,
            stage: 'complete',
            timestamp: new Date().toISOString(),
            status: 'success',
            vulnerabilities_found: totalVulns,
            duration: ((Date.now() - new Date(scanCompletePayload.completedAt).getTime()) / 1000).toFixed(2)
        }));
        return { scanId, error: null };

    } catch (err: any) {
        console.error(JSON.stringify({
            scanId,
            repoId,
            stage: 'fail',
            timestamp: new Date().toISOString(),
            status: 'failed',
            error: err.message,
            stack: err.stack
        }));
        
        if (scanId) {
            try {
                const failPayload = {
                    status: 'failed',
                    completedAt: new Date().toISOString(),
                    details: JSON.stringify({ error: err.message })
                };
                console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
                if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
                await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, failPayload);
            } catch (updateErr: any) {
                console.error(JSON.stringify({
                    scanId,
                    repoId,
                    stage: 'fail_recovery',
                    timestamp: new Date().toISOString(),
                    status: 'critical',
                    error: updateErr.message,
                    stack: updateErr.stack
                }));
            }
        }

        return { scanId, error: err.message || 'Failed to complete scan' };
    }
};


/* =========================================================
   INSIGHTS SUMMARY (required by index.ts)
   ========================================================= */

export const getInsightsSummary = async (userId: string) => {
    try {
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.REPOSITORIES}`);
        if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
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

        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
        if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
        const scansDocs = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.equal('status', 'completed'),
            Query.orderDesc('startedAt'), // Replaced $createdAt with startedAt
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