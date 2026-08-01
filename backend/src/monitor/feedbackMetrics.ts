import { SLA_HOURS, severityBucket } from '../../../shared/sla';

export interface FindingRecord {
  severity: string; scanner: string; status: string;
  createdAt: number; resolvedAt?: number; reopenCount?: number;
  /** Owning repository, when the caller retained it (needed for the per-repo rollup). */
  repoId?: string;
}

/**
 * Maps a findings document to the record the metrics operate on.
 *
 * Exists because the scanner name is stored as `tool`, not `scanner`. Reading
 * `scanner` yielded undefined on every row, so escapeByPhase bucketed all 658
 * findings in the live database as 'unknown' and escapeRecommendations — which
 * drops the unknown bucket — returned an empty list. The escape-phase panel has
 * therefore been silently blank in production, and the auto-tune engine could
 * never have proposed anything.
 *
 * `scanner` is kept as a fallback so callers that already normalise the field
 * (the runtime-incident mapper stamps 'falco' directly) keep working.
 */
export function toFindingRecord(doc: Record<string, unknown>): FindingRecord {
  return {
    severity: String(doc.severity ?? 'info'),
    scanner: String(doc.tool ?? doc.scanner ?? 'unknown'),
    status: String(doc.status ?? 'open'),
    createdAt: new Date(String(doc.$createdAt)).getTime(),
    resolvedAt: doc.resolvedAt ? new Date(String(doc.resolvedAt)).getTime() : undefined,
    reopenCount: Number(doc.reopenCount ?? 0),
    repoId: doc.repo_id ? String(doc.repo_id) : undefined,
  };
}

export interface RepoMttr {
  repoId: string;
  name: string;
  /** Mean time to remediation for this repo, or null when nothing resolved. */
  mttrMs: number | null;
  findingCount: number;
  /** Findings currently past their severity's SLA window. */
  breached: number;
}

/**
 * MTTR per repository, slowest first — the "which repo is holding us up"
 * view that a single aggregate number cannot answer.
 *
 * Scoping is the caller's job: this only groups what it is given, and the
 * feedback route already resolves the finding set through resolveOwnershipScope,
 * so the rollup inherits the tenancy boundary rather than re-deriving one.
 *
 * A repo with nothing resolved reports null, not 0, and sorts last. Zero would
 * rank an untouched backlog as the fastest repo on the board.
 */
export function mttrByRepo(
  findings: FindingRecord[],
  names: Record<string, string>,
  now: number = Date.now(),
): RepoMttr[] {
  const groups = new Map<string, FindingRecord[]>();
  for (const f of findings) {
    if (!f.repoId) continue; // no owner to attribute it to; bucketing them together would invent a repo
    const bucket = groups.get(f.repoId) ?? [];
    bucket.push(f);
    groups.set(f.repoId, bucket);
  }

  const rows: RepoMttr[] = [...groups.entries()].map(([repoId, group]) => {
    const durations = group
      .filter((f) => f.status === 'resolved' && f.resolvedAt !== undefined)
      .map((f) => (f.resolvedAt as number) - f.createdAt);

    const breached = group.filter(
      (f) => f.status !== 'resolved'
        && now - f.createdAt > SLA_HOURS[severityBucket(f.severity)] * 3600_000,
    ).length;

    return {
      repoId,
      // Fall back to the id rather than dropping the row: hiding a repo's
      // backlog because a name lookup missed is worse than an ugly label.
      name: names[repoId] ?? repoId,
      mttrMs: durations.length === 0
        ? null
        : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      findingCount: group.length,
      breached,
    };
  });

  return rows.sort((a, b) => {
    if (a.mttrMs === null && b.mttrMs === null) return 0;
    if (a.mttrMs === null) return 1;  // unmeasurable sorts last, never first
    if (b.mttrMs === null) return -1;
    return b.mttrMs - a.mttrMs;
  });
}

export interface SlaAttainment {
  severity: string;
  targetHours: number;
  /** Mean time to remediation for this severity, or null when nothing resolved. */
  mttrMs: number | null;
  /** Resolved inside the window. */
  met: number;
  /** Resolved late, plus anything still open past its deadline. */
  breached: number;
  /** Still open and still inside the window — outcome not yet decided. */
  open: number;
  /** met / (met + breached), or null when nothing has been decided yet. */
  attainment: number | null;
}

/**
 * SLA attainment per severity: how often remediation actually lands inside the
 * agreed window, alongside the MTTR that produced it.
 *
 * Two deliberate choices:
 *
 * - An open finding already past its deadline counts as BREACHED, not pending.
 *   Excluding it would flatter the number at exactly the moment remediation is
 *   failing — the metric would look best when the backlog is worst.
 * - `attainment` and `mttrMs` are null, never 0, when there is no data. A zero
 *   renders as "0% of SLAs met", a failing grade invented from nothing; it is
 *   the same lie as an empty findings list reading as "all clear".
 *
 * Thresholds come from shared/sla.ts so this agrees with the countdowns the UI
 * already renders.
 */
export function slaAttainment(findings: FindingRecord[], now: number = Date.now()): SlaAttainment[] {
  return Object.keys(SLA_HOURS).map((severity) => {
    const targetHours = SLA_HOURS[severity];
    const targetMs = targetHours * 3600_000;

    const forSeverity = findings.filter((f) => severityBucket(f.severity) === severity);

    let met = 0;
    let breached = 0;
    let open = 0;
    const durations: number[] = [];

    for (const f of forSeverity) {
      if (f.status === 'resolved' && f.resolvedAt !== undefined) {
        const took = f.resolvedAt - f.createdAt;
        durations.push(took);
        if (took <= targetMs) met++;
        else breached++;
      } else if (now - f.createdAt > targetMs) {
        breached++;
      } else {
        open++;
      }
    }

    const decided = met + breached;
    return {
      severity,
      targetHours,
      mttrMs: durations.length === 0
        ? null
        : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      met,
      breached,
      open,
      attainment: decided === 0 ? null : met / decided,
    };
  });
}

const PHASE: Record<string, string> = {
  semgrep: 'build', bandit: 'build', trivy: 'build', gitleaks: 'build',
  zap: 'test', nuclei: 'test', ffuf: 'test', checkov: 'deploy', falco: 'operate',
};

export function mttr(findings: FindingRecord[]): number {
  const durs = findings
    .filter(f => f.status === 'resolved' && f.resolvedAt !== undefined)
    .map(f => (f.resolvedAt as number) - f.createdAt);
  if (durs.length === 0) return 0;
  return Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
}

export function reopenRate(findings: FindingRecord[]): number {
  const resolvedEver = findings.filter(f => f.status === 'resolved' || (f.reopenCount ?? 0) > 0);
  if (resolvedEver.length === 0) return 0;
  const reopened = resolvedEver.filter(f => (f.reopenCount ?? 0) > 0).length;
  return reopened / resolvedEver.length;
}

export function escapeByPhase(findings: FindingRecord[]): { phase: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const phase = PHASE[f.scanner?.toLowerCase()] ?? 'unknown';
    counts.set(phase, (counts.get(phase) ?? 0) + 1);
  }
  return [...counts.entries()].map(([phase, count]) => ({ phase, count }));
}

export interface EscapeRecommendation {
  phase: string;
  count: number;
  share: number;
  recommendation: string;
}

// Where an issue surfaced -> the EARLIER gate to strengthen so it is caught
// sooner next time. This is the "iterate" signal: escapeByPhase shows where the
// pipeline leaks; this says what to tighten. Directed one phase left of the leak.
const EARLIER_GATE: Record<string, string> = {
  code: 'Add plan-phase controls — expand the security requirements set and threat model.',
  build: 'Shift left: enforce SAST and secret scanning at the code phase (pre-commit / PR gate).',
  test: 'Strengthen the build gate — most of these should fail SAST or dependency scanning before test.',
  release: 'Tighten the pre-release compliance gate so violations block the release.',
  deploy: 'Harden the build-phase IaC scan (Checkov) so misconfigurations fail before deploy.',
  operate: 'Threats are reaching runtime — harden the deploy gate and admission policy so they never ship.',
  monitor: 'Improve runtime detection coverage in the operate phase.',
};

/**
 * Turn the escape-by-phase distribution into ranked, directed recommendations —
 * most-leaking phase first, each with its share of total escapes and the
 * earlier gate to strengthen. Drops the 'unknown' bucket (no actionable gate)
 * and returns [] when there is nothing to act on.
 */
export function escapeRecommendations(byPhase: { phase: string; count: number }[]): EscapeRecommendation[] {
  const total = byPhase.reduce((sum, p) => sum + p.count, 0);
  if (total === 0) return [];
  return byPhase
    .filter(p => p.count > 0 && p.phase !== 'unknown')
    .sort((a, b) => b.count - a.count)
    .map(p => ({
      phase: p.phase,
      count: p.count,
      share: p.count / total,
      recommendation: EARLIER_GATE[p.phase] ?? `Review why findings are surfacing at the ${p.phase} phase.`,
    }));
}
