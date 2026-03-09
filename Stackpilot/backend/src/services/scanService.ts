import { account, databases, COLLECTIONS, DB_ID, ID, Query } from '../lib/appwrite';
import { notifyScanCompletion } from './notificationService';
import { orchestrateScan } from './scan/orchestrator';
import { parseSemgrep, parseGitleaks, parseTrivy, Finding } from './scan/parsers';
import { evaluateScan } from './policyService';
import { generateFingerprint } from './gitTraceabilityService';

// ---------------------------------------------------------------------------
// Core scan trigger
// ---------------------------------------------------------------------------

export const triggerScan = async (repoId: string): Promise<{ scanId: string | null; error: string | null }> => {
    try {
        // 1. Rigorous Repo Validation
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);

        if (!repo.url) {
            return { scanId: null, error: 'Repository URL is missing' };
        }

        // Determine target path
        let targetPath = repo.url;
        if (repo.url.startsWith('upload://')) {
            targetPath = repo.local_path;
            if (!targetPath) {
                return { scanId: null, error: 'Local path missing for uploaded repository' };
            }
        }

        // 2. Rate Limit Check
        if (repo.last_scan_at) {
            const lastScan = new Date(repo.last_scan_at).getTime();
            const cooldown = 5 * 60 * 1000; // 5 minutes
            if (Date.now() - lastScan < cooldown) {
                return { scanId: null, error: 'Scan cooldown active. Please wait 5 minutes.' };
            }
        }

        // 3. Create scan record in 'queued' state
        const scan = await databases.createDocument(
            DB_ID,
            COLLECTIONS.SCANS,
            ID.unique(),
            {
                repo_id: repoId,
                status: 'queued',
                scan_type: 'full',
                details: JSON.stringify({ started_at: new Date().toISOString(), target: targetPath }),
            }
        );

        // 4. Async Execution
        (async () => {
            try {
                await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, { status: 'in_progress' });

                if (!targetPath || targetPath.startsWith('http') || targetPath.startsWith('upload://')) {
                    throw new Error(`Target not scanable locally: ${targetPath}`);
                }

                const rawResults = await orchestrateScan(targetPath);

                const findings: Finding[] = [];
                rawResults.forEach(res => {
                    if (res.tool === 'semgrep') findings.push(...parseSemgrep(res.stdout));
                    if (res.tool === 'gitleaks') findings.push(...parseGitleaks(res.stdout));
                    if (res.tool === 'trivy') findings.push(...parseTrivy(res.stdout));
                });

                // 5. Store findings with fingerprints
                if (findings.length > 0) {
                    const findingsWithFingerprints = findings.map(f => ({
                        repo_id: repoId,
                        scan_result_id: scan.$id,
                        tool: f.tool,
                        severity: f.severity,
                        message: f.message,
                        file_path: f.file_path,
                        line_number: f.line_number,
                        status: 'open',
                        resolution_status: 'open',
                        fingerprint: generateFingerprint({ tool: f.tool, file_path: f.file_path || 'unknown', message: f.message })
                    }));

                    // Appwrite doesn't have batch insert, so we use Promise.all for reasonable performance
                    // Note: If findings count is huge, this might need chunking.
                    await Promise.all(findingsWithFingerprints.map(f =>
                        databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITIES, ID.unique(), f)
                    ));

                    // 5b. Smart Reconciliation (Auto-close issues no longer present)
                    const currentFingerprints = findingsWithFingerprints.map(f => f.fingerprint);

                    const openVulns = await databases.listDocuments(
                        DB_ID,
                        COLLECTIONS.VULNERABILITIES,
                        [Query.equal('repo_id', repoId), Query.equal('resolution_status', 'open')]
                    );

                    for (const vuln of openVulns.documents) {
                        if (!currentFingerprints.includes(vuln.fingerprint)) {
                            await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vuln.$id, {
                                resolution_status: 'auto_closed',
                                updated_at: new Date().toISOString()
                            });
                        }
                    }
                } else {
                    // If 0 findings, auto-close ALL currently open ones for this repo
                    const openVulns = await databases.listDocuments(
                        DB_ID,
                        COLLECTIONS.VULNERABILITIES,
                        [Query.equal('repo_id', repoId), Query.equal('resolution_status', 'open')]
                    );
                    for (const vuln of openVulns.documents) {
                        await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vuln.$id, {
                            resolution_status: 'auto_closed',
                            updated_at: new Date().toISOString()
                        });
                    }
                }

                // 6. Calculate results
                const totalVulns = findings.length;
                const criticalCount = findings.filter(f => f.severity === 'critical').length;
                const highCount = findings.filter(f => f.severity === 'high').length;

                const score = Math.max(0, 100 - (criticalCount * 25 + highCount * 10 + (totalVulns - criticalCount - highCount) * 2));
                const riskScore = 100 - score;

                // 7. Update scan & repo
                const currentDetails = JSON.parse(scan.details || '{}');
                await databases.updateDocument(
                    DB_ID,
                    COLLECTIONS.SCANS,
                    scan.$id,
                    {
                        status: 'completed',
                        details: JSON.stringify({
                            ...currentDetails,
                            completed_at: new Date().toISOString(),
                            security_score: score,
                            total_vulnerabilities: totalVulns,
                            critical_count: criticalCount,
                            high_count: highCount,
                            tools: ['semgrep', 'gitleaks', 'trivy'],
                        }),
                    }
                );

                await databases.updateDocument(
                    DB_ID,
                    COLLECTIONS.REPOSITORIES,
                    repoId,
                    {
                        last_scan_at: new Date().toISOString(),
                        vulnerability_count: totalVulns,
                        risk_score: riskScore,
                        updated_at: new Date().toISOString(),
                    }
                );

                console.log(`[ScanService] Scan completed for ${repo.name}. Score: ${score}, Vulns: ${totalVulns}`);
                await notifyScanCompletion(scan.$id);

                // 8. Trigger Policy Evaluation
                await evaluateScan(scan.$id);

            } catch (err: any) {
                console.error('[ScanService] Scan Execution Error:', err);
                await databases.updateDocument(
                    DB_ID,
                    COLLECTIONS.SCANS,
                    scan.$id,
                    { status: 'failed', details: JSON.stringify({ error: err.message || String(err) }) }
                );
            }
        })();

        return { scanId: scan.$id, error: null };
    } catch (error: any) {
        console.error(`[ScanService] Error triggering scan:`, error);
        return { scanId: null, error: error.message || 'Failed to initialize scan' };
    }
};

// ---------------------------------------------------------------------------
// Insights summary
// ---------------------------------------------------------------------------

export const getInsightsSummary = async (userId: string) => {
    try {
        const reposRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId), Query.orderDesc('last_scan_at')]
        );
        const repos = reposRes.documents;

        if (!repos || repos.length === 0) {
            return { repos: [], latestScan: null, overallScore: 0, totalVulns: 0, metrics: [] };
        }

        const repoIds = repos.map((r: any) => r.$id);
        const latestScansRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.SCANS,
            [Query.equal('repo_id', repoIds), Query.equal('status', 'completed'), Query.orderDesc('created_at'), Query.limit(10)]
        );
        const latestScans = latestScansRes.documents;

        const totalVulns = repos.reduce((acc: number, r: any) => acc + (r.vulnerability_count || 0), 0);
        let overallScore = 0;
        if (latestScans && latestScans.length > 0) {
            const details = JSON.parse(latestScans[0].details || '{}');
            overallScore = details.security_score || 0;
        }

        return {
            repos,
            scans: latestScans || [],
            overallScore,
            totalVulns,
        };
    } catch (error: any) {
        console.error('[ScanService] Error fetching insights:', error);
        return { repos: [], latestScan: null, overallScore: 0, totalVulns: 0, metrics: [] };
    }
};
