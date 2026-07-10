import type { SecurityEvent, CorrelationRule, Correlation, RuleCondition } from './securityEvent.types';

function keyOf(e: SecurityEvent, key: CorrelationRule['key']): string {
  return (key === 'actor' ? e.actor : key === 'srcIp' ? e.srcIp : e.target) ?? '';
}

function condMatches(e: SecurityEvent, cond: RuleCondition, prior?: SecurityEvent): boolean {
  if (e.type !== cond.type) return false;
  if (cond.targetEquals && e.target !== cond.targetEquals) return false;
  if (cond.newValueFor === 'srcIp' && prior && e.srcIp === prior.srcIp) return false;
  return true;
}

function matchGroup(sorted: SecurityEvent[], rule: CorrelationRule): Correlation | null {
  let idx = 0;               // condition pointer
  let count = 0;             // occurrences of current condition
  let firstTs = 0;
  let prior: SecurityEvent | undefined;
  const matched: string[] = [];

  for (const e of sorted) {
    const cond = rule.sequence[idx];
    if (!condMatches(e, cond, prior)) continue;
    if (firstTs && e.timestamp - firstTs > rule.windowMs) return null;
    if (!firstTs) firstTs = e.timestamp;
    matched.push(e.id);
    count += 1;
    if (count >= (cond.minCount ?? 1)) {
      prior = e; idx += 1; count = 0;
      if (idx === rule.sequence.length) {
        return {
          ruleId: rule.id, title: rule.title, severity: rule.severity,
          correlationKey: keyOf(e, rule.key),
          bucket: Math.floor(firstTs / rule.windowMs) * rule.windowMs,
          matchedEventIds: matched, ownerUserId: e.ownerUserId,
        };
      }
    }
  }
  return null;
}

export function evaluate(events: SecurityEvent[], rules: CorrelationRule[], _now: number): Correlation[] {
  const out: Correlation[] = [];
  for (const rule of rules) {
    const groups = new Map<string, SecurityEvent[]>();
    for (const e of events) {
      const k = keyOf(e, rule.key);
      if (!k) continue;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
    }
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => a.timestamp - b.timestamp);
      const c = matchGroup(sorted, rule);
      if (c) out.push(c);
    }
  }
  return out;
}
