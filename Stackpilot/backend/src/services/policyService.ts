import { createClient } from '@supabase/supabase-js';
import { notifyPolicyFailure } from './notificationService';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    return createClient(supabaseUrl, supabaseKey);
};

export interface PolicyEvaluation {
    result: 'PASS' | 'WARN' | 'FAIL';
    policyName: string;
    reason?: string;
    details: {
        critical: { found: number, allowed: number };
        high: { found: number, allowed: number };
        risk_score: { found: number, min: number };
    };
}

/**
 * Retrieves the effective policy for a given repository.
 */
export const getEffectivePolicy = async (repoId: string) => {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('effective_project_policies')
        .select('*')
        .eq('repo_id', repoId)
        .single();

    if (error || !data) {
        console.warn(`[PolicyService] Could not find policy for repo ${repoId}, defaulting to balanced.`);
        return {
            policy_name: 'balanced',
            max_critical: 0,
            max_high: 5,
            min_risk_score: 80
        };
    }
    return data;
};

/**
 * Evaluates a completed scan result against the project's policy.
 */
export const evaluateScan = async (scanId: string): Promise<PolicyEvaluation> => {
    const supabase = getSupabase();

    // 1. Get scan metadata
    const { data: scan, error: scanErr } = await supabase
        .from('scan_results')
        .select('*, repositories(id, name)')
        .eq('id', scanId)
        .single();

    if (scanErr || !scan || scan.status !== 'completed') {
        throw new Error('Scan result not available for evaluation');
    }

    const repoId = (scan.repositories as any).id;
    const policy = await getEffectivePolicy(repoId);

    const findings = scan.details || {};
    const criticalFound = findings.critical_count || 0;
    const highFound = findings.high_count || 0;
    const riskScoreFound = 100 - (findings.security_score || 0); // Logic consistent with Dashboard

    const details = {
        critical: { found: criticalFound, allowed: policy.max_critical },
        high: { found: highFound, allowed: policy.max_high },
        risk_score: { found: findings.security_score || 0, min: policy.min_risk_score }
    };

    let result: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    let reason = 'All policy thresholds met.';

    if (criticalFound > policy.max_critical) {
        result = 'FAIL';
        reason = `Critical vulnerabilities (${criticalFound}) exceed policy limit (${policy.max_critical}).`;
    } else if (highFound > policy.max_high) {
        result = 'FAIL';
        reason = `High vulnerabilities (${highFound}) exceed policy limit (${policy.max_high}).`;
    } else if ((findings.security_score || 0) < policy.min_risk_score) {
        result = 'WARN';
        reason = `Security score (${findings.security_score}) is below minimum threshold (${policy.min_risk_score}).`;
    }

    // Persist evaluation
    await supabase.from('policy_evaluations').insert({
        scan_id: scanId,
        repo_id: repoId,
        policy_name: policy.policy_name,
        result,
        details: { ...details, reason }
    });

    console.log(`[PolicyEngine] Evaluation for ${scanId}: ${result}. Reason: ${reason}`);

    // Notify on failure
    if (result === 'FAIL') {
        await notifyPolicyFailure(repoId, scanId, result, reason);
    }

    return { result, policyName: policy.policy_name, reason, details };
};
