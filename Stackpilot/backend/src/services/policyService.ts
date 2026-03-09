import { databases, COLLECTIONS, DB_ID, Query, ID } from '../lib/appwrite';
import { notifyPolicyFailure } from './notificationService';

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
    try {
        // Appwrite doesn't have views, so we check for a custom policy or return default
        const response = await databases.listDocuments(
            DB_ID,
            'project_policies',
            [Query.equal('repo_id', repoId), Query.limit(1)]
        );

        if (response.total === 0) {
            return {
                policy_name: 'balanced',
                max_critical: 0,
                max_high: 5,
                min_risk_score: 80
            };
        }

        const data = response.documents[0];
        // If it's a link to a system policy, we might need to fetch that, 
        // but for now we'll assume the fields are on the document or it's a simple mapping.
        return {
            policy_name: data.policy_name || 'custom',
            max_critical: data.max_critical ?? 0,
            max_high: data.max_high ?? 5,
            min_risk_score: data.min_risk_score ?? 80
        };
    } catch (err) {
        console.warn(`[PolicyService] Error fetching policy for repo ${repoId}, defaulting to balanced.`);
        return {
            policy_name: 'balanced',
            max_critical: 0,
            max_high: 5,
            min_risk_score: 80
        };
    }
};

/**
 * Evaluates a completed scan result against the project's policy.
 */
export const evaluateScan = async (scanId: string): Promise<PolicyEvaluation> => {
    // 1. Get scan metadata
    const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);

    if (!scan || scan.status !== 'completed') {
        throw new Error('Scan result not available for evaluation');
    }

    const repoId = scan.repo_id;
    const policy = await getEffectivePolicy(repoId);

    const findings = typeof scan.details === 'string' ? JSON.parse(scan.details) : (scan.details || {});
    const criticalFound = findings.critical_count || 0;
    const highFound = findings.high_count || 0;

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
    await databases.createDocument(
        DB_ID,
        'policy_evaluations',
        ID.unique(),
        {
            scan_id: scanId,
            repo_id: repoId,
            policy_name: policy.policy_name,
            result,
            details: JSON.stringify({ ...details, reason }),
            created_at: new Date().toISOString()
        }
    );

    console.log(`[PolicyEngine] Evaluation for ${scanId}: ${result}. Reason: ${reason}`);

    // Notify on failure
    if (result === 'FAIL') {
        await notifyPolicyFailure(repoId, scanId, result, reason);
    }

    return { result, policyName: policy.policy_name, reason, details };
};
