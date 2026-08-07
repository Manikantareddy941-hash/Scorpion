import { getDynamicPolicy } from '../services/policyService';
import { evaluatePolicy as evaluateOpaPolicy } from '../services/opaService';
import { logger, errorContext } from '../services/logger';

export interface PolicyConfig {
  blockOn: {
    critical: number;
    high: number;
    secrets: number;
  };
}

export const DEFAULT_POLICY: PolicyConfig = {
  blockOn: {
    critical: 1,    // block if ANY critical CVE found
    high: 5,        // block if 5+ high CVEs found
    secrets: 1      // block if ANY secret detected
  }
};

export interface PolicyResult {
  passed: boolean;
  criticalCount: number;
  highCount: number;
  secretCount: number;
  sastCount: number;
  summary: string;
}

export function evaluatePolicy(scanResults: any, policy: PolicyConfig = DEFAULT_POLICY): PolicyResult {
  const criticalCount = countBySeverity(scanResults.trivy, 'CRITICAL');
  const highCount     = countBySeverity(scanResults.trivy, 'HIGH');
  const secretCount   = Array.isArray(scanResults.gitleaks) ? scanResults.gitleaks.length : 0;
  const sastCount     = scanResults.semgrep?.results?.length ?? 0;

  const passed = (
    criticalCount < policy.blockOn.critical &&
    highCount     < policy.blockOn.high &&
    secretCount   < policy.blockOn.secrets
  );

  return {
    passed,
    criticalCount,
    highCount,
    secretCount,
    sastCount,
    summary: passed
      ? `Clean — ${criticalCount} critical, ${highCount} high, ${secretCount} secrets`
      : `Policy violated`
  };
}

export interface RepoPolicyResult extends PolicyResult {
  denyReasons: string[];
}

/**
 * Async release gate that layers the per-repo policy (thresholds + optional
 * OPA/Rego authored in the Policy Builder, stored in PROJECT_POLICIES) on top
 * of the baseline count check. Purely additive: a repo with no custom policy
 * behaves exactly like evaluatePolicy. Used by the real enforcement points —
 * the GitHub PR status gate (ciOrchestrator) and the deploy gate
 * (argocdHandler) — so authored policy is actually enforced, not just shown
 * on the dashboard.
 */
export async function evaluatePolicyForRepo(
  scanResults: any,
  repoId: string,
  environment = 'production'
): Promise<RepoPolicyResult> {
  const base = evaluatePolicy(scanResults);
  let passed = base.passed;
  const denyReasons: string[] = [];

  let repoPolicy;
  try {
    repoPolicy = await getDynamicPolicy(repoId);
  } catch (err) {
    logger.warn(`[Policy] Per-repo policy load failed for ${repoId}, using baseline only`, errorContext(err));
    return { ...base, denyReasons };
  }

  // Per-repo block-on-critical (defaults to true in DEFAULT_POLICY).
  if (repoPolicy.blockOnCritical && base.criticalCount > 0 && passed) {
    passed = false;
    denyReasons.push(`${base.criticalCount} critical finding(s) — blocked by repo policy (blockOnCritical)`);
  }

  // Optional custom OPA/Rego, evaluated additively. An OPA failure must never
  // crash the gate — fall back to the threshold decision (matches gateService).
  if (repoPolicy.regoCode) {
    try {
      const score = Math.max(0, 100 - base.criticalCount * 15 - base.highCount * 10);
      const opa = await evaluateOpaPolicy(
        { critical_count: base.criticalCount, high_count: base.highCount, security_score: score, environment },
        { regoCode: repoPolicy.regoCode }
      );
      if (!opa.allow) {
        passed = false;
        denyReasons.push(...opa.denyReasons);
      }
    } catch (err) {
      logger.warn(`[Policy] Custom Rego evaluation skipped for ${repoId}`, errorContext(err));
    }
  }

  const summary = passed
    ? base.summary
    : denyReasons.length > 0
      ? `Policy violated: ${denyReasons.join('; ')}`
      : base.summary;

  return { ...base, passed, summary, denyReasons };
}

function countBySeverity(trivyResult: any, severity: string): number {
  if (!trivyResult || !trivyResult.Results) return 0;
  let count = 0;
  trivyResult.Results.forEach((res: any) => {
    if (res.Vulnerabilities) {
      count += res.Vulnerabilities.filter((v: any) => v.Severity === severity).length;
    }
  });
  return count;
}
