import { notifyPolicyFailure } from './notificationService';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';

export interface PolicyConfig {
  minSecurityScore: number;
  blockOnCritical: boolean;
  allowedSnoozeDays: number;
  blockedFalcoRules: string[];
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
          : DEFAULT_POLICY.blockedFalcoRules
      };
    }
  } catch (err: any) {
    console.warn(`[Policy Engine] Failed to load dynamic policy for ${repoId}:`, err.message);
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
        console.warn(`[PolicyService] Error fetching policy for repo ${repoId}:`, err);
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
    Actions: ['gate:bypass', 'policy:edit'],
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
