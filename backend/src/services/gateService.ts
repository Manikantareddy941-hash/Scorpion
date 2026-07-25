import fs from 'fs';
import path from 'path';
import { gateRepository } from '../repositories/gateRepository';
import { getDynamicPolicy } from './policyService';
import { evaluatePolicy } from './opaService';
import { sendSecurityAlert } from './notificationService';
import { logAuditEvent } from '../utils/auditLogger';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { canAccessResource } from './tenancyService';
import { analyzeReachablePackages } from './reachabilityService';
import { logger } from './logger';
import { GateBlocker, GateResult, PipelineGateStatus } from '../types/gate.types';

// SCA reachability filter: drop blockers for packages first-party code never
// imports, so a CVE in an unused transitive dep stops failing the release gate.
// Off by default — opt in per environment once a repo workspace is mounted.
const REACHABILITY_FILTER_ENABLED = process.env.SCA_REACHABILITY_FILTER === 'true';

// Fix-availability filter: don't block a release over a CVE with no fix
// upstream yet — there's no remediation action a developer could take. Only
// drops blockers explicitly marked fixAvailable === false (normalizeTrivy sets
// this for every CVE finding); undefined (non-CVE findings) is never dropped.
// Off by default, same opt-in convention as the reachability filter above.
const FIX_AVAILABLE_FILTER_ENABLED = process.env.SCA_FIX_AVAILABLE_FILTER === 'true';

function filterByFixAvailability(blockers: GateBlocker[]): GateBlocker[] {
  if (!FIX_AVAILABLE_FILTER_ENABLED) return blockers;
  return blockers.filter(b => b.fixAvailable !== false);
}

/** Local source checkout for a repo, or null when none is mounted. Reachability
 *  needs source on disk; without it we cannot prove anything unreachable. */
function resolveRepoSourceDir(repoId: string): string | null {
  const base = process.env.REPO_WORKSPACE_DIR;
  if (!base) return null;
  const dir = path.join(base, repoId);
  if (fs.existsSync(dir)) {
    logger.info(`[gate] resolved repo source dir for ${repoId}: ${dir}`);
    return dir;
  }
  logger.warn(`[gate] repo source dir not found for ${repoId}, attempted path: ${dir}`);
  return null;
}

/** Keep only blockers a real import can reach. Fail-secure on every uncertain
 *  edge — flag off, no source dir, analysis error, or a non-package finding
 *  (SAST/secret) — never drops a blocker, so a broken/absent scan can't quietly
 *  open the gate. Mirrors analyzeReachablePackages' own unknown==reachable rule. */
async function filterByReachability(repoId: string, blockers: GateBlocker[]): Promise<GateBlocker[]> {
  if (!REACHABILITY_FILTER_ENABLED || blockers.length === 0) return blockers;

  const sourceDir = resolveRepoSourceDir(repoId);
  if (!sourceDir) return blockers; // no checkout → prove nothing, drop nothing

  try {
    const pkgNames = blockers
      .map(b => b.packageName || b.package || '')
      .filter((name): name is string => name.length > 0);
    const reachable = new Set(await analyzeReachablePackages(sourceDir, pkgNames));

    return blockers.filter(b => {
      const pkg = b.packageName || b.package;
      if (!pkg) return true; // non-package finding (SAST/secret) — not in scope, keep
      return reachable.has(pkg);
    });
  } catch (err) {
    logger.warn(`[Gate] Reachability filter skipped for ${repoId}:`, err instanceof Error ? err.message : err);
    return blockers; // fail-secure on any analysis error
  }
}

function formatBlockers(blockers: GateBlocker[]) {
  return blockers.map(b => ({
    id: b.$id,
    title: b.title,
    severity: b.severity,
    package: b.packageName || b.package || 'unknown'
  }));
}

/** Computes whether a repository is allowed to be released. */
export async function checkReleaseGate(repoId: string): Promise<GateResult> {
  const allBlockers = await gateRepository.listOpenFindings(repoId);
  const reachableBlockers = await filterByReachability(repoId, allBlockers);
  const blockers = filterByFixAvailability(reachableBlockers);
  const blockerCount = blockers.length;

  // Calculate score
  let score = 100;
  blockers.forEach(b => {
    const sev = (b.severity || 'low').toLowerCase();
    if (sev === 'critical') score -= 15;
    else if (sev === 'high') score -= 10;
    else if (sev === 'medium') score -= 5;
    else score -= 2;
  });
  score = Math.max(0, score);

  const hasCritical = blockers.some(b => (b.severity || '').toLowerCase() === 'critical');
  const criticalCount = blockers.filter(b => (b.severity || '').toLowerCase() === 'critical').length;
  const highCount = blockers.filter(b => (b.severity || '').toLowerCase() === 'high').length;

  // Fetch Dynamic Policy from centralized service
  const policy = await getDynamicPolicy(repoId);

  // Evaluate compliance thresholds dynamically
  let allowed = score >= policy.minSecurityScore && !(policy.blockOnCritical && hasCritical);
  let regoDenyReasons: string[] = [];

  // Additive policy-as-code check: a repo can opt into a custom Rego
  // policy (PROJECT_POLICIES.regoCode) evaluated alongside the threshold
  // check above - either one failing blocks the release. Skips silently
  // if no custom policy is set, or if opa isn't installed/configured -
  // this must never be the reason a gate check itself fails.
  if (policy.regoCode) {
    try {
      const opaResult = await evaluatePolicy(
        { critical_count: criticalCount, high_count: highCount, security_score: score, environment: 'production' },
        { regoCode: policy.regoCode }
      );
      if (!opaResult.allow) {
        allowed = false;
        regoDenyReasons = opaResult.denyReasons;
      }
    } catch (err) {
      logger.warn(`[Gate] Custom Rego policy evaluation skipped for ${repoId}:`, err instanceof Error ? err.message : err);
    }
  }

  return {
    allowed,
    score,
    blocker_count: blockerCount,
    blockers,
    minSecurityScore: policy.minSecurityScore,
    ...(regoDenyReasons.length > 0 ? { regoDenyReasons } : {})
  };
}

export const gateService = {
  async assertRepoAccess(repoId: string, userId: string | undefined): Promise<boolean> {
    const repo = await gateRepository.getRepository(repoId);
    if (!repo) return false;
    return canAccessResource(repo, userId);
  },

  async evaluate(repoId: string) {
    await gateRepository.ensurePipelineStateCollection();
    const result = await checkReleaseGate(repoId);
    const status = result.allowed ? 'passing' : 'BLOCKED';

    if (status === 'BLOCKED') {
      sendSecurityAlert({
        type: 'gate_blocked',
        title: 'CI/CD Release Gate BLOCKED',
        severity: 'CRITICAL',
        details: `Security Gate dropped below 80% compliance threshold.\nPosture Score: ${result.score}%\nActive Blockers: ${result.blocker_count}`,
        repo_id: repoId
      });
    }

    await gateRepository.setReleaseNodeStatus(status);

    return {
      repo_id: repoId,
      score: result.score,
      status,
      blocker_count: result.blocker_count,
      blockers: formatBlockers(result.blockers)
    };
  },

  async checkDeployable(repoId: string): Promise<{ deployable: true } | { deployable: false; minSecurityScore: number; score: number; blockers: ReturnType<typeof formatBlockers> }> {
    await gateRepository.ensurePipelineStateCollection();

    const state = await gateRepository.getReleaseNodeState();
    const isBlocked = state.exists && state.status === 'BLOCKED';

    if (!isBlocked) return { deployable: true };

    const result = await checkReleaseGate(repoId);
    return {
      deployable: false,
      minSecurityScore: result.minSecurityScore,
      score: result.score,
      blockers: formatBlockers(result.blockers)
    };
  },

  async override(repoId: string, userId: string) {
    await gateRepository.ensurePipelineStateCollection();
    await gateRepository.setReleaseNodeStatus('passing');
    await logSecureAuditEvent(userId, 'BREAK_GLASS_BYPASS', repoId, `Manual Break Glass override activated for repository: ${repoId}`);
  },

  async getState(): Promise<{ status: PipelineGateStatus }> {
    await gateRepository.ensurePipelineStateCollection();
    const state = await gateRepository.getReleaseNodeState();
    return { status: state.exists && state.status ? state.status : 'passing' };
  },

  /**
   * Stamp the release-node state with a compliance verdict from the deploy path,
   * so /api/gates/state reflects what actually shipped: BLOCKED (a prod deploy
   * stopped on a violated control) or OVERRIDDEN (a break-glass shipped anyway).
   * This is the single source of truth the Pipeline Gates panel already renders.
   */
  async stampReleaseVerdict(status: PipelineGateStatus): Promise<void> {
    await gateRepository.ensurePipelineStateCollection();
    await gateRepository.setReleaseNodeStatus(status);
  },

  async legacyRelease(repoId: string, userId: string) {
    const result = await checkReleaseGate(repoId);
    await logAuditEvent('GATE_CHECK', `Release gate checked for ${repoId}. Result: ${result.allowed ? 'PASSED' : 'BLOCKED'} (${result.blocker_count} blockers)`, userId, repoId);
    return result;
  },

  async getSummary(userId: string) {
    const reposResponse = await gateRepository.listUserRepos(userId);

    return Promise.all(reposResponse.documents.map(async repo => {
      const gateResult = await checkReleaseGate(repo.$id);
      return {
        repo_id: repo.$id,
        repo_name: repo.name,
        allowed: gateResult.allowed,
        blocker_count: gateResult.blocker_count,
        reasons: gateResult.blockers.map(b => `${(b.severity || '').toUpperCase()} ${b.packageName || 'VULN'}: ${b.title}`)
      };
    }));
  }
};
