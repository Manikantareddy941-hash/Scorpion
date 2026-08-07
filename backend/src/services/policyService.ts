import { notifyPolicyFailure } from './notificationService';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { logger, errorContext } from './logger';

export interface PolicyConfig {
  minSecurityScore: number;
  blockOnCritical: boolean;
  allowedSnoozeDays: number;
  blockedFalcoRules: string[];
  // Optional custom Rego policy (see opaService.ts) evaluated alongside the
  // threshold checks above in checkReleaseGate - additive, not a replacement.
  regoCode?: string;
}

export const DEFAULT_POLICY: PolicyConfig = {
  minSecurityScore: 80,
  blockOnCritical: true,
  allowedSnoozeDays: 14,
  blockedFalcoRules: [
    'Terminal shell opened in container',
    'Write below etc',
    'Unexpected process spawned'
  ]
};

interface CacheEntry {
  data: PolicyConfig;
  expiresAt: number;
}

const policyCache: { [key: string]: CacheEntry } = {};
const CACHE_TTL_MS = 60000; // 60-second TTL Caching

export const getDynamicPolicy = async (repoId: string): Promise<PolicyConfig> => {
  const now = Date.now();
  const cached = policyCache[repoId];
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  let fetchedPolicy: PolicyConfig = { ...DEFAULT_POLICY };
  try {
    const response = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_POLICIES, [
      Query.equal('repo_id', repoId),
      Query.limit(1)
    ]);

    if (response.total > 0) {
      const doc = response.documents[0];
      fetchedPolicy = {
        minSecurityScore: typeof doc.minSecurityScore === 'number' ? doc.minSecurityScore : (doc.min_risk_score || 80),
        blockOnCritical: typeof doc.blockOnCritical === 'boolean' ? doc.blockOnCritical : true,
        allowedSnoozeDays: typeof doc.allowedSnoozeDays === 'number' ? doc.allowedSnoozeDays : 14,
        blockedFalcoRules: doc.blockedFalcoRules
          ? (typeof doc.blockedFalcoRules === 'string' ? JSON.parse(doc.blockedFalcoRules) : doc.blockedFalcoRules)
          : DEFAULT_POLICY.blockedFalcoRules,
        regoCode: typeof doc.regoCode === 'string' ? doc.regoCode : undefined
      };
    }
  } catch (err: any) {
    logger.warn('[Policy Engine] failed to load dynamic policy', {
        event: 'POLICY_LOAD_FAILED',
        repoId,
        ...errorContext(err),
    });
  }

  // Cache policy entry
  policyCache[repoId] = {
    data: fetchedPolicy,
    expiresAt: now + CACHE_TTL_MS
  };

  return fetchedPolicy;
};

export const isFalcoRuleBlocked = async (repoId: string, ruleName: string): Promise<boolean> => {
  const policy = await getDynamicPolicy(repoId);
  const normalizedRule = ruleName.toLowerCase().trim();
  return policy.blockedFalcoRules.some(r => normalizedRule.includes(r.toLowerCase().trim()) || r.toLowerCase().trim().includes(normalizedRule));
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
    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECT_POLICIES, [
            Query.equal('repo_id', repoId),
            Query.limit(1)
        ]);

        if (response.total > 0) {
            return response.documents[0];
        }
    } catch (err) {
        logger.warn(`[PolicyService] Error fetching policy for repo ${repoId}:`, err);
    }

    // Default policy
    return {
        policy_name: 'balanced',
        max_critical: 0,
        max_high: 5,
        min_risk_score: 50
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

    const detailsRaw = typeof scan.details === 'string' ? JSON.parse(scan.details) : scan.details;
    return evaluatePolicyResult(scanId, scan.repo_id, {
        critical: detailsRaw.critical_count || 0,
        high: detailsRaw.high_count || 0,
        securityScore: detailsRaw.security_score || 0,
    });
};

/**
 * Evaluates already-known counts against the repo's policy, persists the
 * evaluation and notifies on failure.
 *
 * evaluateScan re-reads the scan document and requires status 'completed'.
 * triggerScan calls the gate at finalization time, when the document is still
 * 'running' and its details are unwritten — so evaluateScan threw
 * "Scan result not available for evaluation" on every scan, the gate silently
 * fell back to a score heuristic, and no policy_evaluations row was ever
 * written. triggerScan now calls this directly with the counts it just
 * computed in memory, so the gate reflects the real findings.
 */
export const evaluatePolicyResult = async (
    scanId: string,
    repoId: string,
    counts: { critical: number; high: number; securityScore: number },
): Promise<PolicyEvaluation> => {
    const policy = await getEffectivePolicy(repoId);

    const criticalFound = counts.critical;
    const highFound = counts.high;
    const securityScore = counts.securityScore;

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

    logger.info(`[PolicyEngine] Evaluation for ${scanId}: ${result}. Reason: ${reason}`);

    // Notify on failure
    if (result === 'FAIL') {
        await notifyPolicyFailure(repoId, scanId, result, reason);
    }

    return { result, policyName: policy.policy_name, reason, details };
};

export interface IAMStatement {
  Effect: 'Allow' | 'Deny';
  Actions: string[];
  Resources: string[];
}

export const DEFAULT_IAM_POLICY: IAMStatement[] = [
  {
    Effect: 'Allow',
    Actions: ['repo:read', 'repo:scan', 'tasks:read', 'tasks:create', 'tasks:triage', 'threats:read'],
    Resources: ['*']
  },
  {
    Effect: 'Deny',
    Actions: ['gate:bypass', 'policy:edit', 'repo:delete', 'repo:deploy'],
    Resources: ['*']
  }
];

export const ADMIN_IAM_POLICY: IAMStatement[] = [
  {
    Effect: 'Allow',
    Actions: ['*'],
    Resources: ['*']
  }
];

export const evaluateIAM = (statements: IAMStatement[], action: string, resourceId: string): boolean => {
  let allowed = false;

  for (const statement of statements) {
    const effect = statement.Effect;
    const actions = statement.Actions;
    const resources = statement.Resources;

    // Action matching (supports wildcards * and trailing wildcards like repo:*)
    const actionMatch = actions.some(act => {
      if (act === '*') return true;
      if (act.endsWith('*')) {
        const prefix = act.slice(0, -1);
        return action.startsWith(prefix);
      }
      return act === action;
    });

    // Resource matching (supports wildcards * and trailing wildcards like repo-*)
    const resourceMatch = resources.some(res => {
      if (res === '*') return true;
      if (res.endsWith('*')) {
        const prefix = res.slice(0, -1);
        return resourceId.startsWith(prefix);
      }
      return res === resourceId;
    });

    if (actionMatch && resourceMatch) {
      if (effect === 'Deny') {
        return false; // Explicit Deny overrides all
      }
      if (effect === 'Allow') {
        allowed = true;
      }
    }
  }

  return allowed;
};
