export interface FindingRecord {
  severity: string; scanner: string; status: string;
  createdAt: number; resolvedAt?: number; reopenCount?: number;
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
