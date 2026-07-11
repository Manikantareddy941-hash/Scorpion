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
