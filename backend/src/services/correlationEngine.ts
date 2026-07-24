import { StoredRequirement } from '../types/securityRequirements.types';

/**
 * Code & Commit feature: correlate scanner findings back to the Plan-phase
 * security requirements — the return leg of the requirement -> Jira loop.
 *
 * Accuracy contract (deliberate): a finding can only mark a requirement
 * VIOLATED. Scanner silence is NOT proof of compliance, so the absence of
 * findings never upgrades a requirement to satisfied — only a human attestation
 * (the 2a lifecycleStatus) does. This refuses the "failure renders as success"
 * trap: we over-report toward violation (a reviewer looks) rather than
 * manufacture a compliance pass from a scanner that stayed quiet.
 */

export type FindingClass = 'injection' | 'secret' | 'dependency-vuln' | 'iac-misconfig';
export type CorrelationStatus = 'violated' | 'attested' | 'unverified';

/**
 * The finding fields correlation reads. Kept loose and all-optional: persisted
 * findings are third-party-shaped and reach us through the vulnerabilities
 * collection, so the service maps whatever the store returns onto this.
 */
export interface CorrelatableFinding {
  tool?: string;
  category?: string;
  ruleId?: string;
  title?: string;
  message?: string;
  severity?: string;
  status?: string;
}

export interface CorrelatedRequirement {
  requirement: StoredRequirement;
  status: CorrelationStatus;
  matchedFindings: CorrelatableFinding[];
  /**
   * True when a human marked the requirement satisfied/waived yet live findings
   * contradict it — the highest-signal audit output ("you signed this off, but
   * the scanner still sees it").
   */
  contradictsAttestation: boolean;
}

/**
 * Which finding classes provide evidence AGAINST a requirement, keyed by the
 * requirement's category. A category absent here cannot be assessed by these
 * scanners, so its requirements stay 'unverified' unless a human attests.
 *
 * ponytail: category-level join. Upgrade path is per-requirement CWE/rule tags
 * when finer precision than category is worth authoring.
 */
const CATEGORY_EVIDENCE: Record<string, FindingClass[]> = {
  'Secure Coding': ['injection'],
  'Vulnerability Management': ['dependency-vuln', 'iac-misconfig'],
  Cryptography: ['secret'],
};

// SAST injection family — semgrep/bandit carry the raw rule id as `category`,
// so we keyword-match across ruleId/category/title/message rather than an enum.
const INJECTION_RE = /sql|inject|xss|ldap|xxe|ssrf|command|deserial|path.?travers|tainted/i;

/**
 * A finding counts against a requirement only while it is live. Resolved,
 * remediated, dismissed, false-positive and snoozed findings do not violate —
 * a fixed finding is not evidence of a current gap.
 */
export function isActiveFinding(f: CorrelatableFinding): boolean {
  return (f.status ?? 'open').toLowerCase() === 'open';
}

/** Map a finding to a class, or null when it is not one correlation acts on. */
export function classifyFinding(f: CorrelatableFinding): FindingClass | null {
  const cat = (f.category ?? '').toLowerCase();
  const tool = (f.tool ?? '').toLowerCase();
  if (cat === 'secret-exposure' || tool === 'gitleaks') return 'secret';
  if (cat === 'dependency-vulnerability') return 'dependency-vuln';
  if (cat === 'iac-misconfig' || cat === 'dockerfile-lint') return 'iac-misconfig';
  if (tool === 'semgrep' || tool === 'bandit') {
    const hay = `${f.ruleId ?? ''} ${f.category ?? ''} ${f.title ?? ''} ${f.message ?? ''}`;
    if (INJECTION_RE.test(hay)) return 'injection';
  }
  return null;
}

const STATUS_RANK: Record<CorrelationStatus, number> = { violated: 0, unverified: 1, attested: 2 };

/**
 * Correlate a project's requirements against its live findings. Obsolete
 * requirements are dropped; the result is sorted most-actionable first
 * (violated, then unverified, then attested).
 */
export function correlate(
  requirements: StoredRequirement[],
  findings: CorrelatableFinding[],
): CorrelatedRequirement[] {
  const classified = findings
    .filter(isActiveFinding)
    .map((f) => ({ f, cls: classifyFinding(f) }))
    .filter((x): x is { f: CorrelatableFinding; cls: FindingClass } => x.cls !== null);

  return requirements
    .filter((r) => r.lifecycleStatus !== 'obsolete')
    .map((r): CorrelatedRequirement => {
      const classes = CATEGORY_EVIDENCE[r.category] ?? [];
      const matchedFindings = classes.length
        ? classified.filter((x) => classes.includes(x.cls)).map((x) => x.f)
        : [];
      const attested = r.lifecycleStatus === 'satisfied' || r.lifecycleStatus === 'waived';
      const status: CorrelationStatus =
        matchedFindings.length > 0 ? 'violated' : attested ? 'attested' : 'unverified';
      return {
        requirement: r,
        status,
        matchedFindings,
        contradictsAttestation: matchedFindings.length > 0 && attested,
      };
    })
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}
