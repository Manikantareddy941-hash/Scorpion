import { createClient } from '@supabase/supabase-js';
import { notifyScanCompletion } from './notificationService';
import { orchestrateScan } from './scan/orchestrator';
import { parseSemgrep, parseGitleaks, parseTrivy, Finding } from './scan/parsers';
import { evaluateScan } from './policyService';
import { generateFingerprint } from './gitTraceabilityService';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('SUPABASE env vars missing');
    }

    return createClient(supabaseUrl, supabaseKey);
};

export const triggerScan = async (
    repoId: string
): Promise<{ scanId: string | null; error: string | null }> => {
    const supabase = getSupabase();

    // 1️⃣ Validate repo
    const { data: repo, error: repoErr } = await supabase
        .from('repositories')
        .select('*')
        .eq('id', repoId)
        .single();

    if (repoErr || !repo) {
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
    const { data: scan, error: scanErr } = await supabase
        .from('scan_results')
        .insert({
            repo_id: repoId,
            status: 'queued',
            scan_type: 'full',
            details: {
                started_at: new Date().toISOString(),
                target: targetPath
            }
        })
        .select()
        .single();

    if (scanErr || !scan) {
        return { scanId: null, error: 'Failed to create scan record' };
    }

    // 5️⃣ Async execution
    (async () => {
        try {
            await supabase.from('scan_results')
                .update({ status: 'in_progress' })
                .eq('id', scan.id);

            // 🟡 DEV MODE mock for remote repos
            if (targetPath.startsWith('http')) {
                console.log('[ScanService] Mock scanning remote repo:', targetPath);

                await new Promise(r => setTimeout(r, 2000));

                await supabase.from('scan_results').update({
                    status: 'completed',
                    details: {
                        completed_at: new Date().toISOString(),
                        security_score: 82,
                        total_vulnerabilities: 3,
                        tools: ['mock']
                    }
                }).eq('id', scan.id);

                await supabase.from('repositories').update({
                    last_scan_at: new Date().toISOString(),
                    vulnerability_count: 3,
                    risk_score: 18,
                    updated_at: new Date().toISOString()
                }).eq('id', repoId);

                return;
            }

            // 🟢 Real scan
            const rawResults = await orchestrateScan(targetPath);

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
                await supabase.from('vulnerabilities').insert(
                    findings.map(f => ({
                        repo_id: repoId,
                        scan_result_id: scan.id,
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
                    }))
                );
            }

            await supabase.from('scan_results').update({
                status: 'completed',
                details: {
                    completed_at: new Date().toISOString(),
                    security_score: score,
                    total_vulnerabilities: totalVulns,
                    critical_count: criticalCount,
                    high_count: highCount,
                    tools: ['semgrep', 'gitleaks', 'trivy']
                }
            }).eq('id', scan.id);

            await supabase.from('repositories').update({
                last_scan_at: new Date().toISOString(),
                vulnerability_count: totalVulns,
                risk_score: riskScore,
                updated_at: new Date().toISOString()
            }).eq('id', repoId);

            await notifyScanCompletion(scan.id);
            await evaluateScan(scan.id);

            console.log('[ScanService] Scan finished:', repo.name);

        } catch (err: any) {
            console.error('[ScanService] ERROR:', err);

            await supabase.from('scan_results').update({
                status: 'failed',
                details: { error: err.message }
            }).eq('id', scan.id);
        }
    })();

    return { scanId: scan.id, error: null };
};

/* =========================================================
   INSIGHTS SUMMARY (required by index.ts)
   ========================================================= */

export const getInsightsSummary = async (userId: string) => {
    const supabase = getSupabase();

    const { data: repos } = await supabase
        .from('repositories')
        .select('id, name, url, vulnerability_count, last_scan_at, risk_score')
        .eq('user_id', userId)
        .order('last_scan_at', { ascending: false });

    if (!repos || repos.length === 0) {
        return {
            repos: [],
            scans: [],
            overallScore: 0,
            totalVulns: 0
        };
    }

    const { data: scans } = await supabase
        .from('scan_results')
        .select('*')
        .in('repo_id', repos.map(r => r.id))
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(10);

    const totalVulns = repos.reduce(
        (acc: number, r: any) => acc + (r.vulnerability_count || 0),
        0
    );

    const overallScore =
        scans && scans.length > 0
            ? scans[0].details?.security_score || 0
            : 0;

    return {
        repos,
        scans: scans || [],
        overallScore,
        totalVulns
    };
};