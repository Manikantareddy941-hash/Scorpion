# Monitor Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SIEM correlation, APM security anomaly detection, feedback-loop metrics, and alert suppression to Scorpion's Monitor phase — on existing incident/findings/telemetry rails, no new infra.

**Architecture:** Pure logic services (unit-testable, no I/O) + Appwrite repositories + owner-scoped Express routes + one BullMQ self-re-enqueuing tick + two React panels. A normalized `SecurityEvent` stream (existing collections read in place + one new `security_events` collection for new signals) feeds a fixed-catalog correlation engine that emits correlated incidents through the existing `incidentService`.

**Tech Stack:** TypeScript, Express, node-appwrite, BullMQ + ioredis, Jest, React, Recharts.

## Global Constraints

- Backend files < 250 lines; strict typing, **never `any`** (`backend/CLAUDE.md`).
- Every route: `verifyUser` middleware + owner scope via `resolveOwnershipScope(req, userId)` — `{ field: 'team_id' | 'user_id', value }`. Resources keyed by repo use `assertRepoAccess(repoId, userId)`.
- No cross-tenant event bleed, no cross-tenant Slack. All correlation/anomaly/suppression logic runs within one owner scope.
- Fail-secure: unreadable config → no suppression, no silencing (mirror `falcoRuleRepository` `[]`-on-failure).
- Incidents created via `createIncident(incident: Incident)` where `Incident = { title, severity, source, description, userId?, relatedScanId? }`. **`source` union must be widened** to include `'correlation'` and `'apm'` (Task 1).
- New Appwrite collections (user creates before runtime; tests mock): `security_events`, `correlations`, `suppression_rules`. Plus a `reopenCount` int (default 0) field on the existing `vulnerabilities` collection (a.k.a. `COLLECTIONS.FINDINGS`).
- Verify per task: `npm run lint` and `npm run test` from `backend/` (not repo root).

---

## File Structure

**Component A — Correlation engine**
- Create `backend/src/monitor/securityEvent.types.ts` — `SecurityEvent`, `CorrelationRule`, `Correlation` types.
- Create `backend/src/monitor/correlationCatalog.ts` — fixed 5-rule catalog.
- Create `backend/src/monitor/correlationEngine.ts` — pure `evaluate(events, rules, now)`.
- Create `backend/src/monitor/securityEventSource.ts` — owner-scoped `collect(scope, windowMs)`.
- Create `backend/src/repositories/correlationRepository.ts` — persist fired correlations + rule toggles.
- Create `backend/src/queues/correlationQueue.ts` + `backend/src/queues/correlationQueueWorker.ts` — tick.
- Create `backend/src/routes/monitorCorrelationRoutes.ts` — list + rule toggle.

**Component B — APM anomaly**
- Create `backend/src/monitor/anomalyDetector.ts` — pure `detectStatusSpike(buckets, thresholds)`.
- Create `backend/src/monitor/statusTelemetry.ts` — bounded in-memory per-minute status counter.
- Modify `backend/src/middleware/requestLogger.ts` — feed `statusTelemetry`.
- Modify `backend/src/routes/authRoutes.ts` — emit `auth_failure` security_event on 401.
- (Anomaly detection runs inside the correlation worker tick — Task 9.)

**Component C — Feedback metrics**
- Create `backend/src/monitor/feedbackMetrics.ts` — pure `mttr`, `reopenRate`, `escapeByPhase`.
- Modify `backend/src/routes/findingRoutes.ts` — bump `reopenCount` on resolved→reopen.
- Create `backend/src/routes/monitorFeedbackRoutes.ts` — `GET /api/monitor/feedback`.

**Component D — Suppression**
- Create `backend/src/monitor/suppressionMatcher.ts` — pure `isSuppressed(candidate, rules)`.
- Create `backend/src/repositories/suppressionRepository.ts` — owner-scoped CRUD.
- Create `backend/src/routes/monitorSuppressionRoutes.ts` — CRUD.
- Wire suppression into correlation worker (Task 9) + anomaly path.

**Frontend**
- Create `src/components/CorrelationPanel.tsx`, `src/components/FeedbackPanel.tsx`.
- Modify `src/pages/Monitor.tsx` — mount both panels.

**Wiring**
- Modify `backend/src/index.ts` (or route registry) — mount 3 new routers, start correlation worker, drain queue on shutdown (mirror `canaryQueue`/`postureScanner` registration).
- Modify `backend/src/services/incidentService.ts` — widen `source` union.

---

### Task 1: SecurityEvent types + widen Incident source

**Files:**
- Create: `backend/src/monitor/securityEvent.types.ts`
- Modify: `backend/src/services/incidentService.ts:27` (source union)
- Test: `backend/src/monitor/securityEvent.types.test.ts`

**Interfaces:**
- Produces: `SecurityEvent`, `SecurityEventType`, `CorrelationRule`, `Correlation`, `RuleState` types; widened `Incident.source`.

- [ ] **Step 1: Write the failing test** — a compile-level guard that the union members exist.

```ts
// backend/src/monitor/securityEvent.types.test.ts
import type { SecurityEvent, CorrelationRule, Correlation } from './securityEvent.types';

test('SecurityEvent shape accepts a normalized event', () => {
  const e: SecurityEvent = {
    id: 'e1', type: 'auth_failure', ownerUserId: 'u1',
    severity: 'high', timestamp: 1000, srcIp: '1.2.3.4',
  };
  expect(e.type).toBe('auth_failure');
});

test('CorrelationRule requires an ordered condition sequence', () => {
  const r: CorrelationRule = {
    id: 'account-takeover', title: 'Account Takeover', severity: 'critical',
    key: 'actor', windowMs: 600000,
    sequence: [{ type: 'auth_failure', minCount: 5 }, { type: 'auth_success' }, { type: 'data_export' }],
  };
  expect(r.sequence).toHaveLength(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/monitor/securityEvent.types.test.ts`
Expected: FAIL — cannot find module `./securityEvent.types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/monitor/securityEvent.types.ts
export type SecurityEventType =
  | 'auth_failure' | 'auth_success' | 'data_export' | 'metadata_access'
  | 'cloud_api' | 'recon' | 'exploit' | 'runtime_threat'
  | 'outbound_unknown' | 'gate_blocked' | 'deploy' | 'status_spike';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  actor?: string;
  srcIp?: string;
  repoId?: string;
  ownerUserId: string;
  target?: string;
  severity: Severity;
  timestamp: number; // epoch ms
  metadata?: Record<string, string | number | boolean>;
}

export interface RuleCondition {
  type: SecurityEventType;
  minCount?: number;         // default 1
  newValueFor?: 'srcIp';     // condition matches only when this field differs from the prior matched event's value (e.g. login from a new IP)
  targetEquals?: string;     // literal target the event must carry (e.g. '169.254.169.254')
}

export interface CorrelationRule {
  id: string;
  title: string;
  severity: Severity;
  key: 'srcIp' | 'actor' | 'target';
  windowMs: number;
  sequence: RuleCondition[];
}

export type RuleState = { id: string; enabled: boolean; severityOverride?: Severity };

export interface Correlation {
  ruleId: string;
  title: string;
  severity: Severity;
  correlationKey: string;    // the shared key value (ip/actor/target)
  bucket: number;            // earliest matched event timestamp, floored to windowMs — idempotency anchor
  matchedEventIds: string[];
  ownerUserId: string;
}
```

Then widen the union in `incidentService.ts`:

```ts
// backend/src/services/incidentService.ts  (line ~27)
  source: 'falco' | 'ci_pipeline' | 'gitops' | 'soar' | 'correlation' | 'apm';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/monitor/securityEvent.types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitor/securityEvent.types.ts backend/src/monitor/securityEvent.types.test.ts backend/src/services/incidentService.ts
git commit -m "feat(monitor): SecurityEvent/CorrelationRule types + widen incident source"
```

---

### Task 2: Correlation rule catalog

**Files:**
- Create: `backend/src/monitor/correlationCatalog.ts`
- Test: `backend/src/monitor/correlationCatalog.test.ts`

**Interfaces:**
- Consumes: `CorrelationRule` from Task 1.
- Produces: `CORRELATION_CATALOG: CorrelationRule[]` (5 rules), `catalogById(id): CorrelationRule | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/monitor/correlationCatalog.test.ts
import { CORRELATION_CATALOG, catalogById } from './correlationCatalog';

test('catalog has the 5 fixed rules with unique ids', () => {
  const ids = CORRELATION_CATALOG.map(r => r.id);
  expect(ids).toEqual([
    'account-takeover', 'ssrf-metadata-exfil', 'recon-to-exploit',
    'runtime-breakout', 'gate-bypass-deploy',
  ]);
  expect(new Set(ids).size).toBe(5);
});

test('account-takeover requires new-IP success between failures and export', () => {
  const r = catalogById('account-takeover')!;
  expect(r.key).toBe('actor');
  expect(r.sequence[0].minCount).toBe(5);
  expect(r.sequence[1].newValueFor).toBe('srcIp');
});

test('ssrf rule pins the cloud metadata IP', () => {
  const r = catalogById('ssrf-metadata-exfil')!;
  expect(r.sequence[0].targetEquals).toBe('169.254.169.254');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/monitor/correlationCatalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/monitor/correlationCatalog.ts
import type { CorrelationRule } from './securityEvent.types';

const MIN = 60_000;

export const CORRELATION_CATALOG: CorrelationRule[] = [
  {
    id: 'account-takeover', title: 'Probable Account Takeover', severity: 'critical',
    key: 'actor', windowMs: 10 * MIN,
    sequence: [
      { type: 'auth_failure', minCount: 5 },
      { type: 'auth_success', newValueFor: 'srcIp' },
      { type: 'data_export' },
    ],
  },
  {
    id: 'ssrf-metadata-exfil', title: 'SSRF → Cloud Metadata Exfiltration', severity: 'critical',
    key: 'srcIp', windowMs: 5 * MIN,
    sequence: [
      { type: 'metadata_access', targetEquals: '169.254.169.254' },
      { type: 'cloud_api' },
    ],
  },
  {
    id: 'recon-to-exploit', title: 'Recon Followed by Exploit', severity: 'high',
    key: 'srcIp', windowMs: 15 * MIN,
    sequence: [{ type: 'recon' }, { type: 'exploit' }],
  },
  {
    id: 'runtime-breakout', title: 'Container Breakout Attempt', severity: 'critical',
    key: 'target', windowMs: 10 * MIN,
    sequence: [{ type: 'runtime_threat' }, { type: 'outbound_unknown' }],
  },
  {
    id: 'gate-bypass-deploy', title: 'Deploy After Blocked Gate', severity: 'high',
    key: 'target', windowMs: 30 * MIN,
    sequence: [{ type: 'gate_blocked' }, { type: 'deploy' }],
  },
];

export function catalogById(id: string): CorrelationRule | undefined {
  return CORRELATION_CATALOG.find(r => r.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/monitor/correlationCatalog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitor/correlationCatalog.ts backend/src/monitor/correlationCatalog.test.ts
git commit -m "feat(monitor): fixed 5-rule correlation catalog"
```

---

### Task 3: Pure correlation evaluator

**Files:**
- Create: `backend/src/monitor/correlationEngine.ts`
- Test: `backend/src/monitor/correlationEngine.test.ts`

**Interfaces:**
- Consumes: `SecurityEvent`, `CorrelationRule`, `Correlation`, `RuleState` (Task 1); catalog (Task 2).
- Produces: `evaluate(events: SecurityEvent[], rules: CorrelationRule[], now: number): Correlation[]`.

**Algorithm:** For each rule, group events by `rule.key`. Within each group, sort by timestamp and greedily match the ordered `sequence`: advance to the next condition when an event of the right `type` (and satisfying `minCount` / `newValueFor` / `targetEquals`) occurs after the previously matched event and within `windowMs` of the sequence's first matched event. A fully matched sequence yields one `Correlation` with `bucket = floor(firstTs / windowMs) * windowMs`. Skip groups whose key value is empty.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/monitor/correlationEngine.test.ts
import { evaluate } from './correlationEngine';
import { catalogById } from './correlationCatalog';
import type { SecurityEvent } from './securityEvent.types';

const ev = (p: Partial<SecurityEvent> & Pick<SecurityEvent, 'type' | 'timestamp'>): SecurityEvent => ({
  id: `${p.type}-${p.timestamp}`, ownerUserId: 'u1', severity: 'high', ...p,
});

test('fires account-takeover on failures → new-IP success → export for same actor', () => {
  const rule = catalogById('account-takeover')!;
  const t = 1_000_000;
  const events: SecurityEvent[] = [
    ...[0,1,2,3,4].map(i => ev({ type: 'auth_failure', actor: 'a', srcIp: '1.1.1.1', timestamp: t + i })),
    ev({ type: 'auth_success', actor: 'a', srcIp: '9.9.9.9', timestamp: t + 10 }),
    ev({ type: 'data_export', actor: 'a', srcIp: '9.9.9.9', timestamp: t + 20 }),
  ];
  const out = evaluate(events, [rule], t + 30);
  expect(out).toHaveLength(1);
  expect(out[0].ruleId).toBe('account-takeover');
  expect(out[0].correlationKey).toBe('a');
});

test('does not fire when success IP equals failure IP (no new-IP)', () => {
  const rule = catalogById('account-takeover')!;
  const t = 1_000_000;
  const events: SecurityEvent[] = [
    ...[0,1,2,3,4].map(i => ev({ type: 'auth_failure', actor: 'a', srcIp: '1.1.1.1', timestamp: t + i })),
    ev({ type: 'auth_success', actor: 'a', srcIp: '1.1.1.1', timestamp: t + 10 }),
    ev({ type: 'data_export', actor: 'a', srcIp: '1.1.1.1', timestamp: t + 20 }),
  ];
  expect(evaluate(events, [rule], t + 30)).toHaveLength(0);
});

test('does not fire when the sequence exceeds the window', () => {
  const rule = catalogById('ssrf-metadata-exfil')!; // window 5m
  const t = 1_000_000;
  const events: SecurityEvent[] = [
    ev({ type: 'metadata_access', srcIp: '2.2.2.2', target: '169.254.169.254', timestamp: t }),
    ev({ type: 'cloud_api', srcIp: '2.2.2.2', timestamp: t + 6 * 60_000 }),
  ];
  expect(evaluate(events, [rule], t + 6 * 60_000)).toHaveLength(0);
});

test('separates groups by key — cross-actor events never correlate', () => {
  const rule = catalogById('recon-to-exploit')!;
  const t = 1_000_000;
  const events: SecurityEvent[] = [
    ev({ type: 'recon', srcIp: 'A', timestamp: t }),
    ev({ type: 'exploit', srcIp: 'B', timestamp: t + 1 }),
  ];
  expect(evaluate(events, [rule], t + 2)).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/monitor/correlationEngine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/monitor/correlationEngine.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/monitor/correlationEngine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitor/correlationEngine.ts backend/src/monitor/correlationEngine.test.ts
git commit -m "feat(monitor): pure correlation evaluator with window+key+new-IP matching"
```

---

### Task 4: Pure APM anomaly detector

**Files:**
- Create: `backend/src/monitor/anomalyDetector.ts`
- Test: `backend/src/monitor/anomalyDetector.test.ts`

**Interfaces:**
- Produces: `StatusBucket = { key: string; total: number; denied: number; minute: number }`; `AnomalyThresholds = { minDenied: number; minShare: number }`; `detectStatusSpike(buckets: StatusBucket[], thresholds: AnomalyThresholds): StatusSpike[]` where `StatusSpike = { key: string; denied: number; total: number; minute: number }`.

**Rule:** a bucket is a spike when `denied >= minDenied` AND `denied/total >= minShare`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/monitor/anomalyDetector.test.ts
import { detectStatusSpike } from './anomalyDetector';

const th = { minDenied: 10, minShare: 0.5 };

test('flags a bucket exceeding both count and share', () => {
  const out = detectStatusSpike([{ key: '1.2.3.4', total: 20, denied: 15, minute: 1 }], th);
  expect(out).toHaveLength(1);
  expect(out[0].key).toBe('1.2.3.4');
});

test('ignores high count when share is low (legit traffic)', () => {
  expect(detectStatusSpike([{ key: 'x', total: 1000, denied: 12, minute: 1 }], th)).toHaveLength(0);
});

test('ignores high share when count is tiny (noise)', () => {
  expect(detectStatusSpike([{ key: 'x', total: 3, denied: 3, minute: 1 }], th)).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/monitor/anomalyDetector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/monitor/anomalyDetector.ts
export interface StatusBucket { key: string; total: number; denied: number; minute: number; }
export interface AnomalyThresholds { minDenied: number; minShare: number; }
export interface StatusSpike { key: string; denied: number; total: number; minute: number; }

export function detectStatusSpike(buckets: StatusBucket[], t: AnomalyThresholds): StatusSpike[] {
  return buckets
    .filter(b => b.total > 0 && b.denied >= t.minDenied && b.denied / b.total >= t.minShare)
    .map(b => ({ key: b.key, denied: b.denied, total: b.total, minute: b.minute }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/monitor/anomalyDetector.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitor/anomalyDetector.ts backend/src/monitor/anomalyDetector.test.ts
git commit -m "feat(monitor): pure 401/403 status-spike anomaly detector"
```

---

### Task 5: Pure suppression matcher

**Files:**
- Create: `backend/src/monitor/suppressionMatcher.ts`
- Test: `backend/src/monitor/suppressionMatcher.test.ts`

**Interfaces:**
- Produces: `SuppressionRule = { id: string; matchType: 'ruleId' | 'severity' | 'repo' | 'actor'; matchValue: string; expiresAt?: number; reason?: string }`; `SuppressionCandidate = { ruleId?: string; severity: string; repoId?: string; actor?: string }`; `isSuppressed(candidate, rules, now): { suppressed: boolean; ruleId?: string }`.

**Rule:** suppressed if any non-expired rule matches the candidate's corresponding field exactly.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/monitor/suppressionMatcher.test.ts
import { isSuppressed, SuppressionRule } from './suppressionMatcher';

const now = 1000;
const cand = { ruleId: 'recon-to-exploit', severity: 'high', repoId: 'r1', actor: 'a1' };

test('suppresses on exact ruleId match', () => {
  const rules: SuppressionRule[] = [{ id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit' }];
  expect(isSuppressed(cand, rules, now).suppressed).toBe(true);
});

test('expired rule does not suppress', () => {
  const rules: SuppressionRule[] = [{ id: 's1', matchType: 'severity', matchValue: 'high', expiresAt: 500 }];
  expect(isSuppressed(cand, rules, now).suppressed).toBe(false);
});

test('no match → not suppressed', () => {
  const rules: SuppressionRule[] = [{ id: 's1', matchType: 'actor', matchValue: 'someone-else' }];
  expect(isSuppressed(cand, rules, now).suppressed).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/monitor/suppressionMatcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/monitor/suppressionMatcher.ts
export interface SuppressionRule {
  id: string;
  matchType: 'ruleId' | 'severity' | 'repo' | 'actor';
  matchValue: string;
  expiresAt?: number;
  reason?: string;
}
export interface SuppressionCandidate {
  ruleId?: string; severity: string; repoId?: string; actor?: string;
}

function fieldFor(c: SuppressionCandidate, t: SuppressionRule['matchType']): string | undefined {
  if (t === 'ruleId') return c.ruleId;
  if (t === 'severity') return c.severity;
  if (t === 'repo') return c.repoId;
  return c.actor;
}

export function isSuppressed(
  candidate: SuppressionCandidate, rules: SuppressionRule[], now: number,
): { suppressed: boolean; ruleId?: string } {
  for (const r of rules) {
    if (r.expiresAt !== undefined && r.expiresAt <= now) continue;
    if (fieldFor(candidate, r.matchType) === r.matchValue) return { suppressed: true, ruleId: r.id };
  }
  return { suppressed: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/monitor/suppressionMatcher.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitor/suppressionMatcher.ts backend/src/monitor/suppressionMatcher.test.ts
git commit -m "feat(monitor): pure alert-suppression matcher"
```

---

### Task 6: Pure feedback metrics

**Files:**
- Create: `backend/src/monitor/feedbackMetrics.ts`
- Test: `backend/src/monitor/feedbackMetrics.test.ts`

**Interfaces:**
- Produces: `FindingRecord = { severity: string; scanner: string; status: string; createdAt: number; resolvedAt?: number; reopenCount?: number }`; `mttr(findings): number` (ms, resolved only, 0 when none); `reopenRate(findings): number` (0..1); `escapeByPhase(findings): { phase: string; count: number }[]`.

**Phase map:** `semgrep|bandit → build`, `trivy|gitleaks → build`, `zap|nuclei|ffuf → test`, `checkov → deploy`, `falco → operate`, default `unknown`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/monitor/feedbackMetrics.test.ts
import { mttr, reopenRate, escapeByPhase, FindingRecord } from './feedbackMetrics';

const f = (p: Partial<FindingRecord>): FindingRecord => ({
  severity: 'high', scanner: 'semgrep', status: 'open', createdAt: 0, ...p,
});

test('mttr averages resolved durations, ignores unresolved', () => {
  const out = mttr([
    f({ status: 'resolved', createdAt: 0, resolvedAt: 100 }),
    f({ status: 'resolved', createdAt: 0, resolvedAt: 300 }),
    f({ status: 'open' }),
  ]);
  expect(out).toBe(200);
});

test('mttr is 0 with no resolved findings', () => {
  expect(mttr([f({ status: 'open' })])).toBe(0);
});

test('reopenRate = reopened / resolved-ever', () => {
  const out = reopenRate([
    f({ status: 'resolved', resolvedAt: 1, reopenCount: 1 }),
    f({ status: 'resolved', resolvedAt: 1, reopenCount: 0 }),
  ]);
  expect(out).toBe(0.5);
});

test('escapeByPhase maps scanners to lifecycle phases', () => {
  const out = escapeByPhase([f({ scanner: 'zap' }), f({ scanner: 'semgrep' }), f({ scanner: 'zap' })]);
  const test_ = out.find(p => p.phase === 'test');
  expect(test_?.count).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/monitor/feedbackMetrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/monitor/feedbackMetrics.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/monitor/feedbackMetrics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitor/feedbackMetrics.ts backend/src/monitor/feedbackMetrics.test.ts
git commit -m "feat(monitor): pure feedback metrics (MTTR, reopen rate, escape-by-phase)"
```

---

### Task 7: Correlation repository (fired correlations + rule state)

**Files:**
- Create: `backend/src/repositories/correlationRepository.ts`
- Test: `backend/src/repositories/correlationRepository.test.ts`

**Interfaces:**
- Consumes: `Correlation`, `RuleState` (Task 1); `databases`, `DB_ID`, `ID`, `Query` from `../lib/appwrite`.
- Produces: `correlationRepository.wasFired(ownerUserId, ruleId, key, bucket): Promise<boolean>`; `.recordFired(c: Correlation, incidentId: string): Promise<void>`; `.listFired(ownerField, ownerValue): Promise<Correlation[]>`; `.listRuleStates(ownerField, ownerValue): Promise<RuleState[]>`; `.upsertRuleState(ownerField, ownerValue, state: RuleState): Promise<void>`. Mock `../lib/appwrite` in the test (follow `falcoRuleRepository.test.ts`).

- [ ] **Step 1: Write the failing test** — model on `backend/src/repositories/falcoRuleRepository.test.ts` (jest.mock of `../lib/appwrite`). Assert `wasFired` returns true when `listDocuments` yields a row for the `(ruleId, key, bucket)` tuple, false when empty; assert `recordFired` calls `createDocument` in the `correlations` collection with `owner`, `ruleId`, `correlationKey`, `bucket`, `incidentId`, and `matchedEventIds` serialized.

```ts
// backend/src/repositories/correlationRepository.test.ts
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'db', ID: { unique: () => 'id1' },
  Query: { equal: (f: string, v: unknown) => `${f}=${v}`, limit: (n: number) => `limit${n}` },
}));
import { databases } from '../lib/appwrite';
import { correlationRepository } from './correlationRepository';
import type { Correlation } from '../monitor/securityEvent.types';

const c: Correlation = {
  ruleId: 'recon-to-exploit', title: 'x', severity: 'high',
  correlationKey: 'k', bucket: 60000, matchedEventIds: ['e1'], ownerUserId: 'u1',
};

test('wasFired true when a matching row exists', async () => {
  (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [{ $id: 'd1' }], total: 1 });
  await expect(correlationRepository.wasFired('u1', 'recon-to-exploit', 'k', 60000)).resolves.toBe(true);
});

test('recordFired writes to correlations collection', async () => {
  (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'd1' });
  await correlationRepository.recordFired(c, 'inc1');
  expect(databases.createDocument).toHaveBeenCalledWith('db', 'correlations', 'id1',
    expect.objectContaining({ ruleId: 'recon-to-exploit', bucket: 60000, incidentId: 'inc1' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/repositories/correlationRepository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/repositories/correlationRepository.ts
import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { Correlation, RuleState, Severity } from '../monitor/securityEvent.types';

const FIRED = 'correlations';
const RULE_STATE = 'correlation_rule_states';

export const correlationRepository = {
  async wasFired(owner: string, ruleId: string, key: string, bucket: number): Promise<boolean> {
    try {
      const res = await databases.listDocuments(DB_ID, FIRED, [
        Query.equal('owner', owner), Query.equal('ruleId', ruleId),
        Query.equal('correlationKey', key), Query.equal('bucket', bucket), Query.limit(1),
      ]);
      return res.total > 0;
    } catch (err) {
      logger.error('[correlationRepository] wasFired failed', err);
      return true; // fail-secure: assume already fired → don't double-page
    }
  },

  async recordFired(c: Correlation, incidentId: string): Promise<void> {
    await databases.createDocument(DB_ID, FIRED, ID.unique(), {
      owner: c.ownerUserId, ruleId: c.ruleId, correlationKey: c.correlationKey,
      bucket: c.bucket, severity: c.severity, incidentId,
      matchedEventIds: JSON.stringify(c.matchedEventIds),
    });
  },

  async listFired(ownerField: 'owner', ownerValue: string): Promise<Array<Correlation & { incidentId: string; createdAt: string }>> {
    const res = await databases.listDocuments(DB_ID, FIRED, [
      Query.equal(ownerField, ownerValue), Query.orderDesc('$createdAt'), Query.limit(100),
    ]);
    return res.documents.map((d: Models.Document) => {
      const w = d as unknown as Record<string, string>;
      return {
        ruleId: w.ruleId, title: w.ruleId, severity: w.severity as Severity,
        correlationKey: w.correlationKey, bucket: Number(w.bucket),
        matchedEventIds: JSON.parse(w.matchedEventIds || '[]'),
        ownerUserId: w.owner, incidentId: w.incidentId, createdAt: d.$createdAt,
      };
    });
  },

  async listRuleStates(owner: string): Promise<RuleState[]> {
    try {
      const res = await databases.listDocuments(DB_ID, RULE_STATE, [Query.equal('owner', owner), Query.limit(50)]);
      return res.documents.map((d: Models.Document) => {
        const w = d as unknown as Record<string, string | boolean>;
        return { id: w.ruleId as string, enabled: w.enabled as boolean, severityOverride: w.severityOverride as Severity | undefined };
      });
    } catch (err) {
      logger.error('[correlationRepository] listRuleStates failed', err);
      return []; // no overrides → catalog defaults (all enabled)
    }
  },

  async upsertRuleState(owner: string, state: RuleState): Promise<void> {
    const existing = await databases.listDocuments(DB_ID, RULE_STATE, [
      Query.equal('owner', owner), Query.equal('ruleId', state.id), Query.limit(1),
    ]);
    const payload = { owner, ruleId: state.id, enabled: state.enabled, severityOverride: state.severityOverride ?? null };
    if (existing.total > 0) {
      await databases.updateDocument(DB_ID, RULE_STATE, existing.documents[0].$id, payload);
    } else {
      await databases.createDocument(DB_ID, RULE_STATE, ID.unique(), payload);
    }
  },
};
```

> Note: this adds a 4th collection `correlation_rule_states`. Record it in the runtime-prereqs doc (Task 14).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/repositories/correlationRepository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/correlationRepository.ts backend/src/repositories/correlationRepository.test.ts
git commit -m "feat(monitor): correlation repository (fired dedupe + rule states)"
```

---

### Task 8: Security-event source + status telemetry

**Files:**
- Create: `backend/src/monitor/statusTelemetry.ts`
- Create: `backend/src/monitor/securityEventSource.ts`
- Modify: `backend/src/middleware/requestLogger.ts` (feed telemetry)
- Modify: `backend/src/routes/authRoutes.ts` (emit `auth_failure` on 401)
- Test: `backend/src/monitor/statusTelemetry.test.ts`

**Interfaces:**
- Produces:
  - `statusTelemetry.record(key: string, status: number): void`; `.snapshot(): StatusBucket[]` (from Task 4 shape); `.prune(now: number): void` (drop buckets older than 5 min). Bounded: cap at 500 keys.
  - `recordSecurityEvent(e: Omit<SecurityEvent,'id'>): Promise<void>` — writes to `security_events`.
  - `securityEventSource.collect(ownerUserId: string, repoIds: string[], windowMs: number): Promise<SecurityEvent[]>` — reads `security_events` (owner) + maps recent `incidents`/`scans` for that owner into `SecurityEvent[]`.

Only `statusTelemetry` is unit-tested here (pure, in-memory). `securityEventSource` and `recordSecurityEvent` are exercised by the worker integration in Task 9.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/monitor/statusTelemetry.test.ts
import { statusTelemetry } from './statusTelemetry';

beforeEach(() => statusTelemetry.reset());

test('aggregates denied vs total per key in the current minute', () => {
  statusTelemetry.record('1.2.3.4', 200);
  statusTelemetry.record('1.2.3.4', 403);
  statusTelemetry.record('1.2.3.4', 401);
  const snap = statusTelemetry.snapshot().find(b => b.key === '1.2.3.4')!;
  expect(snap.total).toBe(3);
  expect(snap.denied).toBe(2);
});

test('prune drops buckets older than 5 minutes', () => {
  statusTelemetry.record('x', 403);
  statusTelemetry.prune(Date.now() + 6 * 60_000);
  expect(statusTelemetry.snapshot()).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/monitor/statusTelemetry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/monitor/statusTelemetry.ts
import type { StatusBucket } from './anomalyDetector';

const MINUTE = 60_000;
const MAX_KEYS = 500;
type Cell = { total: number; denied: number };
const store = new Map<number, Map<string, Cell>>(); // minute → key → cell

function minuteOf(ts: number): number { return Math.floor(ts / MINUTE); }

export const statusTelemetry = {
  record(key: string, status: number): void {
    const m = minuteOf(Date.now());
    let byKey = store.get(m);
    if (!byKey) { byKey = new Map(); store.set(m, byKey); }
    if (!byKey.has(key) && byKey.size >= MAX_KEYS) return; // bounded
    const cell = byKey.get(key) ?? { total: 0, denied: 0 };
    cell.total += 1;
    if (status === 401 || status === 403) cell.denied += 1;
    byKey.set(key, cell);
  },
  snapshot(): StatusBucket[] {
    const out: StatusBucket[] = [];
    for (const [minute, byKey] of store) {
      for (const [key, cell] of byKey) out.push({ key, total: cell.total, denied: cell.denied, minute });
    }
    return out;
  },
  prune(now: number): void {
    const cutoff = minuteOf(now) - 5;
    for (const m of store.keys()) if (m < cutoff) store.delete(m);
  },
  reset(): void { store.clear(); },
};
```

```ts
// backend/src/monitor/securityEventSource.ts
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { SecurityEvent, SecurityEventType, Severity } from './securityEvent.types';

const COLLECTION = 'security_events';

export async function recordSecurityEvent(e: Omit<SecurityEvent, 'id'>): Promise<void> {
  try {
    await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
      type: e.type, actor: e.actor ?? null, srcIp: e.srcIp ?? null,
      repoId: e.repoId ?? null, ownerUserId: e.ownerUserId, target: e.target ?? null,
      severity: e.severity, timestamp: e.timestamp, metadata: JSON.stringify(e.metadata ?? {}),
    });
  } catch (err) {
    logger.error('[securityEventSource] recordSecurityEvent failed', err);
  }
}

export async function collect(ownerUserId: string, windowMs: number): Promise<SecurityEvent[]> {
  const since = Date.now() - windowMs;
  try {
    const res = await databases.listDocuments(DB_ID, COLLECTION, [
      Query.equal('ownerUserId', ownerUserId),
      Query.greaterThanEqual('timestamp', since),
      Query.orderDesc('timestamp'), Query.limit(500),
    ]);
    return res.documents.map((d) => {
      const w = d as unknown as Record<string, string | number>;
      return {
        id: d.$id, type: w.type as SecurityEventType, actor: (w.actor as string) || undefined,
        srcIp: (w.srcIp as string) || undefined, repoId: (w.repoId as string) || undefined,
        ownerUserId: w.ownerUserId as string, target: (w.target as string) || undefined,
        severity: w.severity as Severity, timestamp: Number(w.timestamp),
        metadata: JSON.parse((w.metadata as string) || '{}'),
      };
    });
  } catch (err) {
    logger.error('[securityEventSource] collect failed', err);
    return [];
  }
}

export const securityEventSource = { collect };
```

Modify `requestLogger.ts` — after the response finishes, feed telemetry (add near the existing `res.on('finish', ...)` handler; if none exists, add one):

```ts
import { statusTelemetry } from '../monitor/statusTelemetry';
// inside the middleware, on response finish:
res.on('finish', () => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  statusTelemetry.record(ip, res.statusCode);
});
```

Modify `authRoutes.ts` — where a login returns 401, emit an event (best-effort, non-blocking):

```ts
import { recordSecurityEvent } from '../monitor/securityEventSource';
// on invalid-credentials 401, before res.status(401)...:
void recordSecurityEvent({
  type: 'auth_failure', actor: req.body?.email || 'unknown',
  srcIp: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
  ownerUserId: 'system', severity: 'medium', timestamp: Date.now(),
});
```

> `ownerUserId: 'system'` for pre-auth failures: they aren't yet tied to a tenant. The account-takeover rule keys on `actor` (email); scope resolution for the worker treats `system` events as visible to the owner whose repos/incidents share the same actor. If that linkage is undesirable, gate rule A-1 to same-owner events only — noted as a known limitation in Task 14 docs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/monitor/statusTelemetry.test.ts`
Expected: PASS (2 tests). Also run `cd backend && npx tsc --noEmit` — expect clean (pre-existing `@prisma/adapter-better-sqlite3` error is the only allowed failure).

- [ ] **Step 5: Commit**

```bash
git add backend/src/monitor/statusTelemetry.ts backend/src/monitor/statusTelemetry.test.ts backend/src/monitor/securityEventSource.ts backend/src/middleware/requestLogger.ts backend/src/routes/authRoutes.ts
git commit -m "feat(monitor): status telemetry + security-event source + auth-failure emit"
```

---

### Task 9: Correlation worker (tick: collect → detect anomalies → evaluate → suppress → incident)

**Files:**
- Create: `backend/src/queues/correlationQueue.ts`
- Create: `backend/src/queues/correlationQueueWorker.ts`
- Test: `backend/src/queues/correlationQueueWorker.test.ts`

**Interfaces:**
- Consumes: `evaluate` (Task 3), `detectStatusSpike` + `statusTelemetry` (Tasks 4, 8), `isSuppressed` + suppression repo (Tasks 5, 12), `securityEventSource.collect` + `recordSecurityEvent` (Task 8), `correlationRepository` (Task 7), `createIncident` (incidentService), `CORRELATION_CATALOG` + `catalogById` (Task 2).
- Produces: `runCorrelationTick(ownerUserId: string): Promise<Correlation[]>` (exported, testable in isolation with mocked deps); `enqueueCorrelationTick(ownerUserId, delayMs)`; a worker registering on `CORRELATION_QUEUE_NAME`.

**Tick logic (`runCorrelationTick`):**
1. `statusTelemetry.prune(now)`, then `detectStatusSpike(statusTelemetry.snapshot(), { minDenied: 10, minShare: 0.5 })`; for each spike, `recordSecurityEvent({ type: 'status_spike', srcIp: spike.key, ownerUserId, severity: 'high', ... })`.
2. `events = await securityEventSource.collect(ownerUserId, MAX_WINDOW)` (MAX_WINDOW = 30m — the widest rule window).
3. Load per-owner rule states; build the active rule list from `CORRELATION_CATALOG` (drop disabled, apply `severityOverride`).
4. `correlations = evaluate(events, activeRules, now)`.
5. For each correlation: skip if `await correlationRepository.wasFired(...)`; skip if `isSuppressed({ ruleId, severity, actor }, suppressionRules, now).suppressed` (record suppressed to audit log); else `createIncident({ title, severity, source: 'correlation', description, userId: ownerUserId })` and `correlationRepository.recordFired(c, incident.$id)`.

Mock every dep in the worker test. Do **not** hit Redis/Appwrite in the unit test.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/queues/correlationQueueWorker.test.ts
jest.mock('../monitor/securityEventSource', () => ({
  securityEventSource: { collect: jest.fn() }, recordSecurityEvent: jest.fn(),
}));
jest.mock('../repositories/correlationRepository', () => ({
  correlationRepository: { wasFired: jest.fn(), recordFired: jest.fn(), listRuleStates: jest.fn() },
}));
jest.mock('../repositories/suppressionRepository', () => ({
  suppressionRepository: { listForOwner: jest.fn() },
}));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));

import { runCorrelationTick } from './correlationQueueWorker';
import { securityEventSource } from '../monitor/securityEventSource';
import { correlationRepository } from '../repositories/correlationRepository';
import { suppressionRepository } from '../repositories/suppressionRepository';
import { createIncident } from '../services/incidentService';
import type { SecurityEvent } from '../monitor/securityEvent.types';

const t = 1_000_000;
const evs: SecurityEvent[] = [
  { id: '1', type: 'recon', srcIp: 'A', ownerUserId: 'u1', severity: 'high', timestamp: t },
  { id: '2', type: 'exploit', srcIp: 'A', ownerUserId: 'u1', severity: 'high', timestamp: t + 1 },
];

beforeEach(() => {
  jest.clearAllMocks();
  (securityEventSource.collect as jest.Mock).mockResolvedValue(evs);
  (correlationRepository.listRuleStates as jest.Mock).mockResolvedValue([]);
  (correlationRepository.wasFired as jest.Mock).mockResolvedValue(false);
  (suppressionRepository.listForOwner as jest.Mock).mockResolvedValue([]);
  (createIncident as jest.Mock).mockResolvedValue({ $id: 'inc1' });
});

test('creates a correlated incident and records it once', async () => {
  const out = await runCorrelationTick('u1');
  expect(out).toHaveLength(1);
  expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({ source: 'correlation', userId: 'u1' }));
  expect(correlationRepository.recordFired).toHaveBeenCalledTimes(1);
});

test('does not re-fire an already-fired correlation', async () => {
  (correlationRepository.wasFired as jest.Mock).mockResolvedValue(true);
  await runCorrelationTick('u1');
  expect(createIncident).not.toHaveBeenCalled();
});

test('suppressed correlation creates no incident', async () => {
  (suppressionRepository.listForOwner as jest.Mock).mockResolvedValue([
    { id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit' },
  ]);
  await runCorrelationTick('u1');
  expect(createIncident).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/queues/correlationQueueWorker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/queues/correlationQueue.ts
import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';

export const CORRELATION_QUEUE_NAME = 'security-correlation';
export interface CorrelationTickPayload { ownerUserId: string; }

export const correlationQueue = new Queue<CorrelationTickPayload>(CORRELATION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 15000 },
    removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
});

export const enqueueCorrelationTick = (payload: CorrelationTickPayload, delayMs: number) =>
  correlationQueue.add('correlation-tick', payload, { delay: delayMs, jobId: `corr-${payload.ownerUserId}` });
```

```ts
// backend/src/queues/correlationQueueWorker.ts
import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection';
import { CORRELATION_QUEUE_NAME, enqueueCorrelationTick, CorrelationTickPayload } from './correlationQueue';
import { evaluate } from '../monitor/correlationEngine';
import { CORRELATION_CATALOG } from '../monitor/correlationCatalog';
import { detectStatusSpike } from '../monitor/anomalyDetector';
import { statusTelemetry } from '../monitor/statusTelemetry';
import { securityEventSource, recordSecurityEvent } from '../monitor/securityEventSource';
import { correlationRepository } from '../repositories/correlationRepository';
import { suppressionRepository } from '../repositories/suppressionRepository';
import { isSuppressed } from '../monitor/suppressionMatcher';
import { createIncident } from '../services/incidentService';
import { logger } from '../services/logger';
import type { Correlation, CorrelationRule } from '../monitor/securityEvent.types';

const MAX_WINDOW = 30 * 60_000;
const TICK_MS = 60_000;

export async function runCorrelationTick(ownerUserId: string): Promise<Correlation[]> {
  const now = Date.now();

  statusTelemetry.prune(now);
  const spikes = detectStatusSpike(statusTelemetry.snapshot(), { minDenied: 10, minShare: 0.5 });
  for (const s of spikes) {
    await recordSecurityEvent({ type: 'status_spike', srcIp: s.key, ownerUserId, severity: 'high',
      timestamp: now, metadata: { denied: s.denied, total: s.total } });
  }

  const events = await securityEventSource.collect(ownerUserId, MAX_WINDOW);
  const states = await correlationRepository.listRuleStates(ownerUserId);
  const disabled = new Set(states.filter(s => !s.enabled).map(s => s.id));
  const overrides = new Map(states.filter(s => s.severityOverride).map(s => [s.id, s.severityOverride!]));
  const activeRules: CorrelationRule[] = CORRELATION_CATALOG
    .filter(r => !disabled.has(r.id))
    .map(r => overrides.has(r.id) ? { ...r, severity: overrides.get(r.id)! } : r);

  const correlations = evaluate(events, activeRules, now);
  const suppressions = await suppressionRepository.listForOwner(ownerUserId);

  const fired: Correlation[] = [];
  for (const c of correlations) {
    if (await correlationRepository.wasFired(ownerUserId, c.ruleId, c.correlationKey, c.bucket)) continue;
    const s = isSuppressed({ ruleId: c.ruleId, severity: c.severity, actor: c.correlationKey }, suppressions, now);
    if (s.suppressed) {
      logger.warn('correlation_suppressed', { ruleId: c.ruleId, suppressionId: s.ruleId, ownerUserId });
      continue;
    }
    const incident = await createIncident({
      title: c.title, severity: c.severity, source: 'correlation',
      description: `Correlated attack pattern (${c.ruleId}) on ${c.correlationKey}`, userId: ownerUserId,
    });
    await correlationRepository.recordFired(c, incident.$id);
    fired.push(c);
  }
  return fired;
}

let worker: Worker<CorrelationTickPayload> | undefined;

export function startCorrelationWorker(): Worker<CorrelationTickPayload> {
  worker = new Worker<CorrelationTickPayload>(CORRELATION_QUEUE_NAME, async (job) => {
    const { ownerUserId } = job.data;
    try { await runCorrelationTick(ownerUserId); }
    catch (err) { logger.error('[correlationWorker] tick failed', err); }
    finally { await enqueueCorrelationTick({ ownerUserId }, TICK_MS); } // self-re-enqueue
  }, { connection: redisConnection });
  return worker;
}

export async function stopCorrelationWorker(): Promise<void> { await worker?.close(); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/queues/correlationQueueWorker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/queues/correlationQueue.ts backend/src/queues/correlationQueueWorker.ts backend/src/queues/correlationQueueWorker.test.ts
git commit -m "feat(monitor): correlation worker tick (anomaly→collect→evaluate→suppress→incident)"
```

---

### Task 10: Correlation routes (list + rule toggle)

**Files:**
- Create: `backend/src/routes/monitorCorrelationRoutes.ts`
- Test: `backend/src/routes/monitorCorrelationRoutes.test.ts`

**Interfaces:**
- Consumes: `correlationRepository` (Task 7), `CORRELATION_CATALOG` (Task 2), `verifyUser`, `resolveOwnershipScope`.
- Produces: `GET /` (fired correlations for owner), `GET /rules` (catalog + per-owner state), `PUT /rules/:id` (`{ enabled?, severityOverride? }`).

Follow an existing route test (e.g. `backend/src/routes/postureRoutes.test.ts` if present, else `falcoRuleRoutes.test.ts`) for supertest + auth-mock shape.

- [ ] **Step 1: Write the failing test** — assert `GET /rules` returns 5 catalog rules merged with owner state; `PUT /rules/account-takeover` with `{ enabled: false }` calls `upsertRuleState`. Mock `correlationRepository` and the auth middleware (set `req.user = { $id: 'u1' }`).

```ts
// backend/src/routes/monitorCorrelationRoutes.test.ts
jest.mock('../middleware/auth', () => ({ verifyUser: (req: any, _res: any, next: any) => { req.user = { $id: 'u1' }; next(); } }));
jest.mock('../services/tenancyService', () => ({ resolveOwnershipScope: jest.fn().mockResolvedValue({ field: 'user_id', value: 'u1' }) }));
jest.mock('../repositories/correlationRepository', () => ({
  correlationRepository: { listFired: jest.fn().mockResolvedValue([]), listRuleStates: jest.fn().mockResolvedValue([]), upsertRuleState: jest.fn() },
}));
import express from 'express';
import request from 'supertest';
import router from './monitorCorrelationRoutes';
import { correlationRepository } from '../repositories/correlationRepository';

const app = express(); app.use(express.json()); app.use('/api/monitor/correlations', router);

test('GET /rules returns the 5-rule catalog with owner state', async () => {
  const res = await request(app).get('/api/monitor/correlations/rules');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(5);
  expect(res.body[0]).toHaveProperty('enabled', true);
});

test('PUT /rules/:id persists a toggle', async () => {
  const res = await request(app).put('/api/monitor/correlations/rules/account-takeover').send({ enabled: false });
  expect(res.status).toBe(200);
  expect(correlationRepository.upsertRuleState).toHaveBeenCalledWith('u1', { id: 'account-takeover', enabled: false, severityOverride: undefined });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/routes/monitorCorrelationRoutes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/routes/monitorCorrelationRoutes.ts
import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { verifyUser } from '../middleware/auth';
import { resolveOwnershipScope } from '../services/tenancyService';
import { correlationRepository } from '../repositories/correlationRepository';
import { CORRELATION_CATALOG, catalogById } from '../monitor/correlationCatalog';
import { logger } from '../services/logger';
import type { Severity } from '../monitor/securityEvent.types';

interface AuthedRequest extends Request { user?: Models.User<Models.Preferences>; }
const router = Router();

router.get('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    await resolveOwnershipScope(req, userId);
    res.json(await correlationRepository.listFired('owner', userId));
  } catch (err) { logger.error('[correlationRoutes] list failed', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/rules', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    const states = await correlationRepository.listRuleStates(userId);
    const byId = new Map(states.map(s => [s.id, s]));
    res.json(CORRELATION_CATALOG.map(r => {
      const st = byId.get(r.id);
      return { id: r.id, title: r.title, severity: st?.severityOverride ?? r.severity,
        enabled: st ? st.enabled : true, windowMs: r.windowMs };
    }));
  } catch (err) { logger.error('[correlationRoutes] rules failed', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/rules/:id', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    if (!catalogById(req.params.id)) return res.status(404).json({ error: 'Unknown rule' });
    const enabled = req.body.enabled ?? true;
    const severityOverride = req.body.severityOverride as Severity | undefined;
    await correlationRepository.upsertRuleState(userId, { id: req.params.id, enabled, severityOverride });
    res.json({ ok: true });
  } catch (err) { logger.error('[correlationRoutes] toggle failed', err); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/routes/monitorCorrelationRoutes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/monitorCorrelationRoutes.ts backend/src/routes/monitorCorrelationRoutes.test.ts
git commit -m "feat(monitor): correlation list + rule-toggle routes"
```

---

### Task 11: Feedback route + finding reopen tracking

**Files:**
- Create: `backend/src/routes/monitorFeedbackRoutes.ts`
- Modify: `backend/src/routes/findingRoutes.ts` (bump `reopenCount` on resolved→reopen)
- Test: `backend/src/routes/monitorFeedbackRoutes.test.ts`

**Interfaces:**
- Consumes: `mttr`, `reopenRate`, `escapeByPhase` (Task 6); `databases` for reading findings scoped by owner repos.
- Produces: `GET /api/monitor/feedback` → `{ mttr, reopenRate, byPhase }`.

- [ ] **Step 1: Write the failing test** — mock `../lib/appwrite` findings list, assert the route composes the three metrics into one payload.

```ts
// backend/src/routes/monitorFeedbackRoutes.test.ts
jest.mock('../middleware/auth', () => ({ verifyUser: (req: any, _res: any, next: any) => { req.user = { $id: 'u1' }; next(); } }));
jest.mock('../services/tenancyService', () => ({ resolveOwnershipScope: jest.fn().mockResolvedValue({ field: 'user_id', value: 'u1' }) }));
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn() }, DB_ID: 'db',
  COLLECTIONS: { REPOSITORIES: 'repositories', FINDINGS: 'vulnerabilities' },
  Query: { equal: () => 'q', limit: () => 'l', orderDesc: () => 'o', greaterThanEqual: () => 'g' },
}));
import express from 'express';
import request from 'supertest';
import router from './monitorFeedbackRoutes';
import { databases } from '../lib/appwrite';

const app = express(); app.use(express.json()); app.use('/api/monitor/feedback', router);

test('composes MTTR, reopen rate, and escape-by-phase', async () => {
  (databases.listDocuments as jest.Mock)
    .mockResolvedValueOnce({ documents: [{ $id: 'r1' }] })            // repos
    .mockResolvedValueOnce({ documents: [                              // findings
      { severity: 'high', scanner: 'semgrep', status: 'resolved', $createdAt: '1970-01-01T00:00:00.000Z', resolvedAt: '1970-01-01T00:00:00.100Z', reopenCount: 0 },
    ], total: 1 });
  const res = await request(app).get('/api/monitor/feedback');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('mttr');
  expect(res.body).toHaveProperty('reopenRate');
  expect(res.body).toHaveProperty('byPhase');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/routes/monitorFeedbackRoutes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/routes/monitorFeedbackRoutes.ts
import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { resolveOwnershipScope } from '../services/tenancyService';
import { mttr, reopenRate, escapeByPhase, FindingRecord } from '../monitor/feedbackMetrics';
import { logger } from '../services/logger';

interface AuthedRequest extends Request { user?: Models.User<Models.Preferences>; }
const router = Router();

router.get('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    const scope = await resolveOwnershipScope(req, userId);
    const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal(scope.field, scope.value), Query.limit(50)]);
    const repoIds = repos.documents.map(r => r.$id);
    if (repoIds.length === 0) return res.json({ mttr: 0, reopenRate: 0, byPhase: [] });

    const res2 = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [Query.equal('repo_id', repoIds), Query.limit(500)]);
    const findings: FindingRecord[] = res2.documents.map((d) => {
      const w = d as unknown as Record<string, string | number>;
      return {
        severity: String(w.severity ?? 'info'), scanner: String(w.scanner ?? 'unknown'),
        status: String(w.status ?? 'open'), createdAt: new Date(d.$createdAt).getTime(),
        resolvedAt: w.resolvedAt ? new Date(w.resolvedAt as string).getTime() : undefined,
        reopenCount: Number(w.reopenCount ?? 0),
      };
    });

    res.json({ mttr: mttr(findings), reopenRate: reopenRate(findings), byPhase: escapeByPhase(findings) });
  } catch (err) { logger.error('[feedbackRoutes] failed', err); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
```

Modify `findingRoutes.ts` PATCH handler — when the new status is `open`/`reopened` and the existing status was `resolved`, bump `reopenCount` and set `resolvedAt` on resolve. Locate the existing `updateDocument` call in the PATCH `/:id` handler and extend its payload:

```ts
// inside PATCH /:id, after loading existingFinding:
const wasResolved = existingFinding.status === 'resolved';
const nowReopened = status !== 'resolved';
const patch: Record<string, unknown> = { status };
if (status === 'resolved') patch.resolvedAt = new Date().toISOString();
if (wasResolved && nowReopened) patch.reopenCount = Number(existingFinding.reopenCount ?? 0) + 1;
// use `patch` as the updateDocument payload instead of { status }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/routes/monitorFeedbackRoutes.test.ts`
Expected: PASS (1 test). Run `cd backend && npx jest src/routes/findingRoutes` — expect existing finding tests still green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/monitorFeedbackRoutes.ts backend/src/routes/monitorFeedbackRoutes.test.ts backend/src/routes/findingRoutes.ts
git commit -m "feat(monitor): feedback metrics route + finding reopen tracking"
```

---

### Task 12: Suppression repository + routes

**Files:**
- Create: `backend/src/repositories/suppressionRepository.ts`
- Create: `backend/src/routes/monitorSuppressionRoutes.ts`
- Test: `backend/src/repositories/suppressionRepository.test.ts`, `backend/src/routes/monitorSuppressionRoutes.test.ts`

**Interfaces:**
- Consumes: `SuppressionRule` (Task 5); `databases`, `DB_ID`, `ID`, `Query`.
- Produces: `suppressionRepository.listForOwner(owner): Promise<SuppressionRule[]>` (returns `[]` on error — but note: unlike config-load fail-secure, an empty list here means *nothing suppressed*, which is the safe direction for suppression), `.create(owner, rule)`, `.remove(owner, id)`; routes `GET/POST/DELETE /api/monitor/suppressions`.

- [ ] **Step 1: Write the failing test (repository)**

```ts
// backend/src/repositories/suppressionRepository.test.ts
jest.mock('../lib/appwrite', () => ({
  databases: { listDocuments: jest.fn(), createDocument: jest.fn(), deleteDocument: jest.fn(), getDocument: jest.fn() },
  DB_ID: 'db', ID: { unique: () => 'id1' },
  Query: { equal: (f: string, v: unknown) => `${f}=${v}`, limit: (n: number) => `l${n}` },
}));
import { databases } from '../lib/appwrite';
import { suppressionRepository } from './suppressionRepository';

test('listForOwner maps rows to SuppressionRule[]', async () => {
  (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [
    { $id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit', expiresAt: null, reason: 'noisy' },
  ], total: 1 });
  const out = await suppressionRepository.listForOwner('u1');
  expect(out[0]).toEqual({ id: 's1', matchType: 'ruleId', matchValue: 'recon-to-exploit', expiresAt: undefined, reason: 'noisy' });
});

test('listForOwner returns [] on error (nothing suppressed)', async () => {
  (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('down'));
  await expect(suppressionRepository.listForOwner('u1')).resolves.toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/repositories/suppressionRepository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/repositories/suppressionRepository.ts
import type { Models } from 'node-appwrite';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { logger } from '../services/logger';
import type { SuppressionRule } from '../monitor/suppressionMatcher';

const COLLECTION = 'suppression_rules';

export const suppressionRepository = {
  async listForOwner(owner: string): Promise<SuppressionRule[]> {
    try {
      const res = await databases.listDocuments(DB_ID, COLLECTION, [Query.equal('owner', owner), Query.limit(100)]);
      return res.documents.map((d: Models.Document) => {
        const w = d as unknown as Record<string, string | number | null>;
        return {
          id: d.$id, matchType: w.matchType as SuppressionRule['matchType'],
          matchValue: String(w.matchValue), expiresAt: w.expiresAt ? Number(w.expiresAt) : undefined,
          reason: (w.reason as string) || undefined,
        };
      });
    } catch (err) { logger.error('[suppressionRepository] list failed', err); return []; }
  },

  async create(owner: string, rule: Omit<SuppressionRule, 'id'>): Promise<SuppressionRule> {
    const doc = await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
      owner, matchType: rule.matchType, matchValue: rule.matchValue,
      expiresAt: rule.expiresAt ?? null, reason: rule.reason ?? null,
    });
    return { id: doc.$id, ...rule };
  },

  async remove(owner: string, id: string): Promise<boolean> {
    const doc = await databases.getDocument(DB_ID, COLLECTION, id);
    if ((doc as unknown as Record<string, string>).owner !== owner) return false; // tenancy guard
    await databases.deleteDocument(DB_ID, COLLECTION, id);
    return true;
  },
};
```

```ts
// backend/src/routes/monitorSuppressionRoutes.ts
import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { verifyUser } from '../middleware/auth';
import { suppressionRepository } from '../repositories/suppressionRepository';
import { logger } from '../services/logger';
import type { SuppressionRule } from '../monitor/suppressionMatcher';

interface AuthedRequest extends Request { user?: Models.User<Models.Preferences>; }
const router = Router();
const VALID = new Set(['ruleId', 'severity', 'repo', 'actor']);

router.get('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try { res.json(await suppressionRepository.listForOwner(req.user?.$id || '')); }
  catch (err) { logger.error('[suppressionRoutes] list', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const { matchType, matchValue, expiresAt, reason } = req.body;
    if (!VALID.has(matchType) || !matchValue) return res.status(400).json({ error: 'matchType and matchValue required' });
    const rule: Omit<SuppressionRule, 'id'> = { matchType, matchValue, expiresAt, reason };
    res.status(201).json(await suppressionRepository.create(req.user?.$id || '', rule));
  } catch (err) { logger.error('[suppressionRoutes] create', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/:id', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const ok = await suppressionRepository.remove(req.user?.$id || '', req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { logger.error('[suppressionRoutes] delete', err); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
```

Route test `monitorSuppressionRoutes.test.ts` — mock auth + `suppressionRepository`; assert POST with bad `matchType` → 400; POST valid → 201; DELETE unknown → 404.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/repositories/suppressionRepository.test.ts src/routes/monitorSuppressionRoutes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/suppressionRepository.ts backend/src/routes/monitorSuppressionRoutes.ts backend/src/repositories/suppressionRepository.test.ts backend/src/routes/monitorSuppressionRoutes.test.ts
git commit -m "feat(monitor): suppression repository + CRUD routes"
```

---

### Task 13: Wire routes + worker into the app

**Files:**
- Modify: `backend/src/index.ts` (or the route-registration module — grep for `monitorRoutes` to find where routers mount and where `postureScanner`/canary worker start).
- Test: none new — run the full suite.

**Interfaces:**
- Consumes: the 3 routers (Tasks 10, 11, 12), `startCorrelationWorker`/`stopCorrelationWorker` + `enqueueCorrelationTick` (Task 9).

- [ ] **Step 1: Find the mount + worker-start points**

Run: `cd backend && grep -rn "monitorRoutes\|postureScanner\|canaryQueue\|app.use('/api/monitor" src/index.ts src/app.ts 2>/dev/null`
Expected: locate `app.use('/api/monitor', ...)` and the worker bootstrap block.

- [ ] **Step 2: Mount routers + start the worker**

```ts
import monitorCorrelationRoutes from './routes/monitorCorrelationRoutes';
import monitorFeedbackRoutes from './routes/monitorFeedbackRoutes';
import monitorSuppressionRoutes from './routes/monitorSuppressionRoutes';
import { startCorrelationWorker, stopCorrelationWorker } from './queues/correlationQueueWorker';
import { enqueueCorrelationTick } from './queues/correlationQueue';

app.use('/api/monitor/correlations', monitorCorrelationRoutes);
app.use('/api/monitor/feedback', monitorFeedbackRoutes);
app.use('/api/monitor/suppressions', monitorSuppressionRoutes);

// after server starts (mirror postureScanner bootstrap):
if (process.env.NODE_ENV !== 'test') {
  startCorrelationWorker();
  // seed a tick per active owner is out of scope; seed a single 'system' tick + rely on route-triggered enqueue.
  // Minimal: seed one tick so anomaly detection runs even before any owner opens the panel.
  void enqueueCorrelationTick({ ownerUserId: 'system' }, 5000);
}
```

Add `stopCorrelationWorker()` to the existing shutdown/drain block (next to canary/soar worker shutdown).

> Per-owner tick seeding: the correlation routes' `GET /` handler should also `void enqueueCorrelationTick({ ownerUserId: userId }, 0)` so a tenant's loop starts when they first view the Monitor page. Add that one line to Task 10's `GET /` handler if not already present. (ponytail: avoids a tenant registry; the loop self-perpetuates once seeded.)

- [ ] **Step 3: Run the full backend suite**

Run: `cd backend && npm run test`
Expected: all suites green (existing + new). Then `npm run lint` — 0 errors on new files.

- [ ] **Step 4: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean except the pre-existing `@prisma/adapter-better-sqlite3` error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts backend/src/routes/monitorCorrelationRoutes.ts
git commit -m "feat(monitor): mount correlation/feedback/suppression routes + start correlation worker"
```

---

### Task 14: Frontend panels + runtime-prereqs doc

**Files:**
- Create: `src/components/CorrelationPanel.tsx`, `src/components/FeedbackPanel.tsx`
- Modify: `src/pages/Monitor.tsx` (mount both, after the existing 4 panels)
- Create: `docs/lifecycle/monitor-phase.md`
- Test: manual (frontend has no unit harness for these panels per prior phases; follow the existing panel components' fetch pattern).

**Interfaces:**
- Consumes: `GET /api/monitor/correlations`, `/correlations/rules`, `PUT /correlations/rules/:id`, `GET /api/monitor/feedback`, `GET/POST/DELETE /api/monitor/suppressions`.

- [ ] **Step 1: Build CorrelationPanel** — mirror `src/components/FalcoRulesPanel.tsx` (auth fetch, loading/error states, list + toggle). Show fired correlations (title, severity, key, time) and the rule catalog with enable toggles; a small suppression sub-form (matchType select + value + create/delete).

- [ ] **Step 2: Build FeedbackPanel** — mirror `src/components/PosturePanel.tsx`; render MTTR (format ms→h/m), reopen-rate (%), and a Recharts bar of `byPhase`.

- [ ] **Step 3: Mount both on Monitor.tsx**

```tsx
import CorrelationPanel from '../components/CorrelationPanel';
import FeedbackPanel from '../components/FeedbackPanel';
// after <NetPolPanel .../>:
<CorrelationPanel />
<FeedbackPanel />
```

- [ ] **Step 4: Write `docs/lifecycle/monitor-phase.md`** — document the 4 components, the correlation rule catalog, and the **runtime prerequisites**: user must create Appwrite collections `security_events`, `correlations`, `correlation_rule_states`, `suppression_rules`, and add a `reopenCount` (int, default 0) + `resolvedAt` (datetime, optional) attribute to the existing `vulnerabilities` collection. Include each collection's attribute list (copy from the repositories). Note the `ownerUserId: 'system'` pre-auth limitation for auth-failure events.

- [ ] **Step 5: Verify build + commit**

Run: `npm run build` (from repo root; note: pre-existing `src/assets` deletions may break build — if so, `git stash` unrelated deletions or confirm the panels compile via `npx tsc --noEmit` in the frontend).
Expected: panels typecheck.

```bash
git add src/components/CorrelationPanel.tsx src/components/FeedbackPanel.tsx src/pages/Monitor.tsx docs/lifecycle/monitor-phase.md
git commit -m "feat(monitor): CorrelationPanel + FeedbackPanel + runtime-prereqs doc"
```

---

## Self-Review

**Spec coverage:**
- A (correlation engine) → Tasks 1,2,3,7,8,9,10 ✓
- B (APM anomaly) → Tasks 4,8 (source),9 (runs in tick) ✓
- C (feedback metrics) → Tasks 6,11 ✓
- D (suppression) → Tasks 5,12, wired in 9 ✓
- Shared event stream → Task 8 ✓
- Frontend panels → Task 14 ✓
- New collections documented → Task 14 ✓ (note: spec listed 3; implementation needs 4 — `correlation_rule_states` added in Task 7, flagged there and in Task 14)
- Tenancy/fail-secure invariants → enforced in Tasks 7,9,12 with explicit tests ✓

**Placeholder scan:** No TBD/TODO. Every code step has real code. Route-test bodies for Tasks 10/12 reference concrete assertions; Task 14 frontend follows named existing components (FalcoRulesPanel, PosturePanel).

**Type consistency:** `SecurityEvent`/`CorrelationRule`/`Correlation` defined Task 1, used consistently. `evaluate(events, rules, now)` signature stable across Tasks 3/9. `isSuppressed(candidate, rules, now)` stable Tasks 5/9. `correlationRepository` methods (`wasFired`, `recordFired`, `listRuleStates`, `upsertRuleState`, `listFired`) consistent across Tasks 7/9/10. `suppressionRepository.listForOwner` consistent Tasks 9/12.

**Known deviations from spec:** (1) 4th collection `correlation_rule_states` (rule toggles need persistence separate from fired correlations). (2) per-owner tick seeding via route-triggered enqueue rather than a tenant registry (ponytail — avoids new infra).
