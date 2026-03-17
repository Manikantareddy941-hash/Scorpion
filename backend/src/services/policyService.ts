import { notifyPolicyFailure } from './notificationService';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';

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
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_POLICIES, [
            Query.equal('repo_id', repoId),
            Query.limit(1)
        ]);

        if (response.total > 0) {
            return response.documents[0];
        }
    } catch (err) {
        console.warn(`[PolicyService] Error fetching policy for repo ${repoId}:`, err);
    }

    // Default policy
    return {
        policy_name: 'balanced',
        max_critical: 0,
        max_high: 5,
        min_risk_score: 80
    };
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

    const detailsRaw = typeof scan.details === 'string' ? JSON.parse(scan.details) : scan.details;
    const criticalFound = detailsRaw.critical_count || 0;
    const highFound = detailsRaw.high_count || 0;
    const securityScore = detailsRaw.security_score || 0;

    const details = {
        critical: { found: criticalFound, allowed: policy.max_critical },
        high: { found: highFound, allowed: policy.max_high },
        risk_score: { found: securityScore, min: policy.min_risk_score }
    };

    let result: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    let reason = 'All policy thresholds met.';

    if (criticalFound > policy.max_critical) {
        result = 'FAIL';
        reason = `Critical vulnerabilities (${criticalFound}) exceed policy limit (${policy.max_critical}).`;
    } else if (highFound > policy.max_high) {
        result = 'FAIL';
        reason = `High vulnerabilities (${highFound}) exceed policy limit (${policy.max_high}).`;
    } else if (securityScore < policy.min_risk_score) {
        result = 'WARN';
        reason = `Security score (${securityScore}) is below minimum threshold (${policy.min_risk_score}).`;
    }

    // Persist evaluation
    await databases.createDocument(DB_ID, COLLECTIONS.POLICY_EVALUATIONS, ID.unique(), {
        scan_id: scanId,
        repo_id: repoId,
        policy_name: policy.policy_name,
        result,
        details: JSON.stringify({ ...details, reason }),
        created_at: new Date().toISOString()
    });

    console.log(`[PolicyEngine] Evaluation for ${scanId}: ${result}. Reason: ${reason}`);

    // Notify on failure
    if (result === 'FAIL') {
        await notifyPolicyFailure(repoId, scanId, result, reason);
    }

    return { result, policyName: policy.policy_name, reason, details };
};
