import { NormalizedIssue } from './normalizer';

/**
 * SARIF 2.1.0 -> NormalizedIssue.
 *
 * The whole point of SARIF ingest is to be pipeline-agnostic: CodeQL, Semgrep,
 * Trivy, Snyk, Gitleaks, Checkov and friends all emit SARIF, so a customer can
 * pipe their existing CI output here and get the same findings — and the same
 * requirement correlation — as the built-in orchestrator produces.
 *
 * This only reads the handful of fields it needs and tolerates missing ones:
 * a malformed report yields [] rather than throwing, because an ingest that
 * crashes on one odd result would drop the whole batch.
 */

interface SarifRegion { startLine?: number; endLine?: number }
interface SarifPhysicalLocation { artifactLocation?: { uri?: string }; region?: SarifRegion }
interface SarifLocation { physicalLocation?: SarifPhysicalLocation }
interface SarifProperties { 'security-severity'?: string; tags?: string[] }
interface SarifResult {
  ruleId?: string;
  ruleIndex?: number;
  level?: string;
  message?: { text?: string };
  locations?: SarifLocation[];
  properties?: SarifProperties;
}
interface SarifRule {
  id?: string;
  name?: string;
  shortDescription?: { text?: string };
  properties?: SarifProperties;
  defaultConfiguration?: { level?: string };
}
interface SarifRun {
  tool?: { driver?: { name?: string; rules?: SarifRule[] } };
  results?: SarifResult[];
}
interface SarifLog { runs?: SarifRun[] }

const CVE_RULE = /^(CVE-|GHSA-|SNYK-|RUSTSEC-|OSV-)/i;
const SECRET_TOOLS = /gitleaks|trufflehog|ggshield|detect-secrets/i;
const SECRET_RULE = /secret|password|api[-_]?key|token|credential/i;
const SCA_TOOLS = /trivy|grype|snyk|osv|dependency-?check|npm-?audit|owasp/i;
const IAC_TOOLS = /checkov|tfsec|kics|terrascan|hadolint|trivy-config/i;
const IAC_RULE = /^(CKV|AVD-|DS\d|SC\d|DL\d)/i;

const lastSegment = (id: string): string => id.split(/[./]/).filter(Boolean).pop() ?? id;

// Map CVSS-style security-severity (0-10) to the shared severity band.
function severityFromScore(score: number): NormalizedIssue['severity'] {
  if (score >= 9) return 'CRITICAL';
  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'INFO';
}

function severityFromLevel(level?: string): NormalizedIssue['severity'] {
  switch (level?.toLowerCase()) {
    case 'error': return 'HIGH';
    case 'warning': return 'MEDIUM';
    case 'note': return 'LOW';
    default: return 'INFO';
  }
}

/**
 * Canonical class the correlation engine understands. Well-known SCA/secret/IaC
 * tools get a stable category; anything else keeps its rule id as the category
 * so downstream injection keyword-matching still applies (mirrors how the
 * internal Semgrep normalizer stores the rule id).
 */
function inferCategory(tool: string, ruleId: string, tags: string[]): string {
  const tagged = tags.map((t) => t.toLowerCase());
  if (SECRET_TOOLS.test(tool) || SECRET_RULE.test(ruleId) || tagged.includes('secret')) return 'secret-exposure';
  if (SCA_TOOLS.test(tool) || CVE_RULE.test(ruleId)) return 'dependency-vulnerability';
  if (IAC_TOOLS.test(tool) || IAC_RULE.test(ruleId)) return 'iac-misconfig';
  return ruleId;
}

function stripScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

export function normalizeSarif(log: unknown): NormalizedIssue[] {
  const runs = (log as SarifLog)?.runs;
  if (!Array.isArray(runs)) return [];

  const issues: NormalizedIssue[] = [];
  for (const run of runs) {
    const driver = run?.tool?.driver;
    const tool = (driver?.name ?? 'sarif').toLowerCase();
    const rules = driver?.rules ?? [];

    for (const result of run?.results ?? []) {
      const rule = typeof result.ruleIndex === 'number'
        ? rules[result.ruleIndex]
        : rules.find((r) => r.id === result.ruleId);

      const ruleId = result.ruleId ?? rule?.id ?? '';
      const loc = result.locations?.[0]?.physicalLocation;
      const line = loc?.region?.startLine ?? 0;
      const score = Number(result.properties?.['security-severity'] ?? rule?.properties?.['security-severity']);
      const severity = Number.isFinite(score) && score > 0
        ? severityFromScore(score)
        : severityFromLevel(result.level ?? rule?.defaultConfiguration?.level);

      issues.push({
        tool,
        type: 'security',
        severity,
        title: rule?.name ?? rule?.shortDescription?.text ?? (ruleId ? lastSegment(ruleId) : 'Finding'),
        message: result.message?.text ?? rule?.shortDescription?.text ?? '',
        file: stripScheme(loc?.artifactLocation?.uri ?? ''),
        line,
        endLine: loc?.region?.endLine ?? line,
        code: '',
        effort: '5min',
        category: inferCategory(tool, ruleId, rule?.properties?.tags ?? []),
        ruleId,
      });
    }
  }
  return issues;
}
