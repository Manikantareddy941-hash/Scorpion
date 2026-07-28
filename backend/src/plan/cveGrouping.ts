import { ADVISORY_ID_RULE } from '../scanners/sarifNormalizer';

export interface CveCluster {
  /** The advisory id every finding in this cluster shares (CVE/GHSA/OSV/...). */
  cveId: string;
  /** Worst severity present — a cluster is as urgent as its worst instance. */
  severity: string;
  findingCount: number;
  repoIds: string[];
  findingIds: string[];
}

/** Highest first; anything unrecognised sorts below the known levels. */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

function severityRank(severity: string): number {
  const i = SEVERITY_ORDER.indexOf(String(severity).toLowerCase());
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/**
 * Clusters findings by the upstream advisory they share, so one Log4j CVE
 * across six repositories becomes one unit of work rather than six unrelated
 * rows.
 *
 * The advisory id is the finding's `ruleId` — SCA scanners emit CVE-/GHSA-/
 * OSV-style rule ids directly, which is why this needs no new field and no
 * backfill. It reuses the same recogniser the SARIF normaliser classifies with,
 * rather than a second copy that could drift from it.
 *
 * SAST rule ids (`python.lang.security.sql-injection`) are deliberately NOT
 * grouped: they are real findings but not a shared upstream advisory, so
 * collapsing them into one epic would merge unrelated work.
 *
 * Resolved findings are excluded — grouping exists to organise outstanding
 * remediation, and a cluster of already-fixed items is noise.
 */
export function groupFindingsByCve(findings: unknown[]): CveCluster[] {
  const byAdvisory = new Map<string, CveCluster>();

  for (const raw of findings) {
    if (!raw || typeof raw !== 'object') continue; // tolerate malformed rows rather than throwing mid-report
    const f = raw as Record<string, unknown>;

    const ruleId = typeof f.ruleId === 'string' ? f.ruleId : '';
    if (!ADVISORY_ID_RULE.test(ruleId)) continue;

    const status = String(f.status ?? 'open').toLowerCase();
    if (status === 'resolved') continue;

    const severity = String(f.severity ?? 'info');
    const findingId = typeof f.$id === 'string' ? f.$id : '';
    const repoId = typeof f.repo_id === 'string' ? f.repo_id : '';

    const existing = byAdvisory.get(ruleId);
    if (!existing) {
      byAdvisory.set(ruleId, {
        cveId: ruleId,
        severity,
        findingCount: 1,
        repoIds: repoId ? [repoId] : [],
        findingIds: findingId ? [findingId] : [],
      });
      continue;
    }

    existing.findingCount++;
    if (findingId) existing.findingIds.push(findingId);
    if (repoId && !existing.repoIds.includes(repoId)) existing.repoIds.push(repoId);
    if (severityRank(severity) < severityRank(existing.severity)) existing.severity = severity;
  }

  // Worst first, then by how widely the advisory has spread — the ordering an
  // engineer triages in.
  return [...byAdvisory.values()].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity)
      || b.findingCount - a.findingCount
      || a.cveId.localeCompare(b.cveId),
  );
}
