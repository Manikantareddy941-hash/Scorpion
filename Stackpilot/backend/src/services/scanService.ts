import { createClient } from '@supabase/supabase-js';
import { notifyScanCompletion } from './notificationService';
import { orchestrateScan } from './scan/orchestrator';
import { parseSemgrep, parseGitleaks, parseTrivy, Finding } from './scan/parsers';
import { evaluateScan } from './policyService';
import { generateFingerprint } from './gitTraceabilityService';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    return createClient(supabaseUrl, supabaseKey);
};

// ---------------------------------------------------------------------------
// Core scan trigger
// ---------------------------------------------------------------------------

export const triggerScan = async (repoId: string): Promise<{ scanId: string | null; error: string | null }> => {
    const supabase = getSupabase();

    // 1. Rigorous Repo Validation
    const { data: repo, error: repoErr } = await supabase
        .from('repositories')
        .select('*')
        .eq('id', repoId)
        .single();

    if (repoErr || !repo) {
        console.error(`[ScanService] Validation failed: Repo ${repoId} not found`);
        return { scanId: null, error: 'Repository not found in system' };
    }

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
    const { data: scan, error: scanErr } = await supabase
        .from('scan_results')
        .insert({
            repo_id: repoId,
            status: 'queued',
            scan_type: 'full',
            details: { started_at: new Date().toISOString(), target: targetPath },
        })
        .select()
        .single();

    if (scanErr || !scan) {
        return { scanId: null, error: 'Failed to initialize scan record' };
    }

    // 4. Async Execution
    (async () => {
        try {
            await supabase.from('scan_results').update({ status: 'in_progress' }).eq('id', scan.id);

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
                    scan_result_id: scan.id,
                    tool: f.tool,
                    severity: f.severity,
                    message: f.message,
                    file_path: f.file_path,
                    line_number: f.line_number,
                    status: 'open',
                    resolution_status: 'open',
                    fingerprint: generateFingerprint({ tool: f.tool, file_path: f.file_path || 'unknown', message: f.message })
                }));

                await supabase.from('vulnerabilities').insert(findingsWithFingerprints);

                // 5b. Smart Reconciliation (Auto-close issues no longer present)
                const currentFingerprints = findingsWithFingerprints.map(f => f.fingerprint);

                await supabase
                    .from('vulnerabilities')
                    .update({
                        resolution_status: 'auto_closed',
                        updated_at: new Date().toISOString()
                    })
                    .eq('repo_id', repoId)
                    .eq('resolution_status', 'open')
                    .not('fingerprint', 'in', `(${currentFingerprints.join(',')})`);
            } else {
                // If 0 findings, auto-close ALL currently open ones for this repo
                await supabase
                    .from('vulnerabilities')
                    .update({
                        resolution_status: 'auto_closed',
                        updated_at: new Date().toISOString()
                    })
                    .eq('repo_id', repoId)
                    .eq('resolution_status', 'open');
            }

            // 6. Calculate results
            const totalVulns = findings.length;
            const criticalCount = findings.filter(f => f.severity === 'critical').length;
            const highCount = findings.filter(f => f.severity === 'high').length;

            const score = Math.max(0, 100 - (criticalCount * 25 + highCount * 10 + (totalVulns - criticalCount - highCount) * 2));
            const riskScore = 100 - score;

            // 7. Update scan & repo
            await supabase
                .from('scan_results')
                .update({
                    status: 'completed',
                    details: {
                        started_at: scan.details?.started_at,
                        completed_at: new Date().toISOString(),
                        security_score: score,
                        total_vulnerabilities: totalVulns,
                        critical_count: criticalCount,
                        high_count: highCount,
                        tools: ['semgrep', 'gitleaks', 'trivy'],
                    },
                })
                .eq('id', scan.id);

            await supabase
                .from('repositories')
                .update({
                    last_scan_at: new Date().toISOString(),
                    vulnerability_count: totalVulns,
                    risk_score: riskScore,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', repoId);

            console.log(`[ScanService] Scan completed for ${repo.name}. Score: ${score}, Vulns: ${totalVulns}`);
            await notifyScanCompletion(scan.id);

            // 8. Trigger Policy Evaluation
            await evaluateScan(scan.id);

        } catch (err: any) {
            console.error('[ScanService] Scan Execution Error:', err);
            await supabase
                .from('scan_results')
                .update({ status: 'failed', details: { error: err.message || String(err) } })
                .eq('id', scan.id);
        }
    })();

    // 5. Return immediately with the scan record ID
    return { scanId: scan.id, error: null };
};

// ---------------------------------------------------------------------------
// Insights summary
// ---------------------------------------------------------------------------

export const getInsightsSummary = async (userId: string) => {
    const supabase = getSupabase();

    const { data: repos } = await supabase
        .from('repositories')
        .select('id, url, name, vulnerability_count, last_scan_at, language, stars')
        .eq('user_id', userId)
        .order('last_scan_at', { ascending: false });

    if (!repos || repos.length === 0) {
        return { repos: [], latestScan: null, overallScore: 0, totalVulns: 0, metrics: [] };
    }

    const { data: latestScans } = await supabase
        .from('scan_results')
        .select(`*, code_metrics (*)`)
        .in('repo_id', repos.map(r => r.id))
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(10);

    const totalVulns = repos.reduce((acc: number, r: any) => acc + (r.vulnerability_count || 0), 0);
    let overallScore = 0;
    if (latestScans && latestScans.length > 0) {
        overallScore = latestScans[0].details?.security_score || 0;
    }

    return {
        repos,
        scans: latestScans || [],
        overallScore,
        totalVulns,
    };
};
