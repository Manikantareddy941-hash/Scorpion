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

// Finds ALL non-overlapping matches of rule.sequence within sorted (one group's events).
// After a completed match or a window-abort, scanning restarts from the next unconsumed
// event instead of stopping — a window-abort or an earlier success must not hide a later
// genuine sequence in the same group.
function matchGroup(sorted: SecurityEvent[], rule: CorrelationRule): Correlation[] {
  const out: Correlation[] = [];
  let start = 0;

  while (start < sorted.length) {
    let idx = 0;              // condition pointer
    let count = 0;            // occurrences of current condition
    let firstTs = -1;         // -1 = unset; window anchor is the first matched event's timestamp
    let prior: SecurityEvent | undefined;
    const matched: string[] = [];
    let consumedUpTo = start; // index (exclusive) to resume from after this attempt
    let completed: Correlation | null = null;

    for (let i = start; i < sorted.length; i += 1) {
      const e = sorted[i];
      const cond = rule.sequence[idx];
      if (!condMatches(e, cond, prior)) continue;
      if (firstTs >= 0 && e.timestamp - firstTs > rule.windowMs) {
        consumedUpTo = i; // restart from this event, it may begin a fresh sequence
        break;
      }
      if (firstTs < 0) firstTs = e.timestamp;
      matched.push(e.id);
      count += 1;
      if (count >= (cond.minCount ?? 1)) {
        // prior is the last fully-matched event; combining minCount > 1 with newValueFor on
        // the SAME condition is not supported (prior only tracks the single latest match) —
        // no catalog rule currently does this.
        prior = e; idx += 1; count = 0;
        if (idx === rule.sequence.length) {
          completed = {
            ruleId: rule.id, title: rule.title, severity: rule.severity,
            correlationKey: keyOf(e, rule.key),
            bucket: Math.floor(firstTs / rule.windowMs) * rule.windowMs,
            matchedEventIds: matched, ownerUserId: e.ownerUserId,
          };
          consumedUpTo = i + 1; // non-overlapping: resume after the consumed events
          break;
        }
      }
      consumedUpTo = i + 1;
    }

    if (completed) out.push(completed);
    if (consumedUpTo <= start) break; // no progress possible, avoid infinite loop
    start = consumedUpTo;
  }
  return out;
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
      out.push(...matchGroup(sorted, rule));
    }
  }
  return out;
}
