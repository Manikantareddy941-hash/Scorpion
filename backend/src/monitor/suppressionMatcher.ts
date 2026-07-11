export interface SuppressionRule {
  id: string;
  matchType: 'ruleId' | 'severity' | 'repo' | 'actor';
  matchValue: string;
  expiresAt?: number;
  reason?: string;
}

export interface SuppressionCandidate {
  ruleId?: string;
  severity: string;
  repoId?: string;
  actor?: string;
}

function fieldFor(c: SuppressionCandidate, t: SuppressionRule['matchType']): string | undefined {
  if (t === 'ruleId') return c.ruleId;
  if (t === 'severity') return c.severity;
  if (t === 'repo') return c.repoId;
  return c.actor;
}

export function isSuppressed(
  candidate: SuppressionCandidate,
  rules: SuppressionRule[],
  now: number,
): { suppressed: boolean; ruleId?: string } {
  for (const r of rules) {
    if (r.expiresAt !== undefined && r.expiresAt <= now) continue;
    if (fieldFor(candidate, r.matchType) === r.matchValue) return { suppressed: true, ruleId: r.id };
  }
  return { suppressed: false };
}
