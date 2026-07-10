# Monitor Phase — Design

Date: 2026-07-10
Branch: `feat/monitor-phase` (off `feat/operate-phase`)
Status: Approved

## Goal

Close the remaining Monitor-phase gaps in Scorpion: aggregate security telemetry,
**correlate** anomalies into multi-stage attack detections, cut alert fatigue, and feed
actionable metrics back to the Plan phase. Four thin components on the existing
incident / findings / telemetry rails — no new infrastructure. Shape mirrors the
Operate phase (pure logic + repository + route + BullMQ tick + panel).

## What already exists (not rebuilt)

- **Log aggregation** — Loki/Prometheus/Tempo stack, `telemetryBuffer`, `monitorRoutes`
  aggregation, structured security events (`services/logEvents.ts`; `runtime_threat`
  already carries a `correlated` flag nobody currently sets).
- **Vuln aggregation + dedup** — `backend/src/deduplication.ts` merges the same finding
  across SAST/DAST/SCA/container by hash into one, tracking `sources[]`. This is the
  DefectDojo dedup, minus the metrics layer (component C adds that).
- **SOAR playbooks** — full engine (Operate phase).
- **Incident → Slack**, findings management, uptime/health, Prometheus `/metrics`.
- 4 Monitor panels (SOAR, Falco, Posture, NetPol).

## Shared spine: normalized security-event stream

The correlation engine needs a queryable event stream. Existing signals (scans,
incidents, Falco threats, gate blocks) already land in Appwrite and are **read in
place**. Only two genuinely-new signal types are written: **auth failures** and
**status-spikes** (from B). Both write to one new `security_events` collection. No mass
rewiring of existing emit points.

`SecurityEvent` normalized shape:

```ts
interface SecurityEvent {
  id: string;
  type: string;          // 'auth_failure' | 'auth_success' | 'data_export' |
                         // 'metadata_access' | 'cloud_api' | 'recon' | 'exploit' |
                         // 'runtime_threat' | 'outbound_unknown' | 'gate_blocked' |
                         // 'deploy' | 'status_spike'
  actor?: string;        // user id / principal, when known
  srcIp?: string;
  repoId?: string;
  ownerUserId: string;   // tenancy scope — never cross-tenant
  target?: string;       // endpoint, image, pod, host
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  timestamp: number;     // epoch ms
  metadata?: Record<string, string | number | boolean>;
}
```

## A. SIEM Correlation Engine (flagship)

- **Pure evaluator** `correlationEngine.evaluate(events, rules, now)` → `Correlation[]`.
  A rule is an ordered sequence of event-type conditions sharing a correlation key
  (`srcIp` or `actor`) within a time window. No I/O; fully unit-testable.
- **Fixed rule catalog (5, like Falco's 5 templates):**
  1. `account-takeover` — `auth_failure` ≥N → `auth_success` (new srcIp for same actor) →
     `data_export`, key=actor, window 10m, severity critical.
  2. `ssrf-metadata-exfil` — `metadata_access` (target `169.254.169.254`) → `cloud_api`
     (AssumeRole/DescribeInstances), key=srcIp, window 5m, severity critical.
  3. `recon-to-exploit` — `recon` → `exploit` on same target, key=srcIp, window 15m, high.
  4. `runtime-breakout` — `runtime_threat` (shell-in-container) → `outbound_unknown` same
     target, key=target, window 10m, critical.
  5. `gate-bypass-deploy` — `gate_blocked` (critical) → `deploy` of same image, key=target,
     window 30m, high.
- Each rule has a per-owner toggle + severity override (persisted with rule state),
  like Falco rule tuning. Unknown/disabled rules never fire.
- **Event source** `securityEventSource.collect(scope, windowMs)` — owner-scoped; maps
  existing collections (`incidents`, `scans`, `notifications`, Falco threats) **plus**
  `security_events` into `SecurityEvent[]`.
- **Scheduler** — BullMQ `correlation` queue, self-re-enqueuing ~60s tick with an
  immediate first tick (postureScanner / canary pattern). Runs per owner scope.
- **Output** — a match creates a correlated incident (reuse `incidentService`,
  `correlated: true`) and fires owner-scoped Slack. **Idempotency:** dedupe by
  `ruleId + correlationKey + earliestEventBucket`, persisted in a new `correlations`
  collection, so each distinct attack fires once — not every tick.
- **Routes** — `GET /api/monitor/correlations` (list fired), `GET /api/monitor/correlations/rules`
  (catalog + toggles), `PUT /api/monitor/correlations/rules/:id` (toggle / severity).

## B. APM Security Anomaly

- **Pure detector** `anomalyDetector.detectStatusSpike(buckets, thresholds)` — per-minute
  401/403 counts keyed by `srcIp`/`path`; flags spikes over an absolute threshold and a
  share-of-requests threshold. No I/O.
- **Source** — extend `middleware/requestLogger` with a bounded in-memory per-minute
  status counter (no Prometheus HTTP-status metrics exist; an in-memory ring is the
  correct minimal cut). The 401 auth paths also emit a structured `auth_failure`
  `security_event`.
- **Output** — a spike writes a `status_spike` `security_event` (feeds rule A-1) and, if
  severe, raises its own incident. Runs on the same correlation tick (no second queue).

## C. Feedback-Loop Metrics

- **Pure calcs** over findings/incident history:
  - `feedbackMetrics.mttr(findings)` — avg(resolvedAt − createdAt) for resolved findings.
  - `feedbackMetrics.reopenRate(findings)` — resolved-then-reopened / total resolved, from
    a `reopenCount` field bumped in `findingRoutes` on a resolved→reopen transition.
  - `feedbackMetrics.escapeByPhase(findings)` — scanner → lifecycle-phase map (which phase
    a finding escaped to before detection).
- **Route** `GET /api/monitor/feedback` (owner-scoped) → `{ mttr, reopenRate, byPhase[], trend[] }`.
- **Panel** `FeedbackPanel` on `Monitor.tsx` — MTTR trend, reopen-rate, findings-by-phase bars.
- Small schema touch: add `reopenCount` (int, default 0) to the existing `findings`
  collection; `resolvedAt` derived from status-change timestamp.

## D. Alert Suppression

- **Pure matcher** `suppressionMatcher.isSuppressed(candidate, rules)` — match by
  `ruleId` / `severity` / `repo` / `actor` / `pattern`, with optional `expiresAt`.
- Applied in **both** the correlation-output and anomaly-incident paths **before** Slack /
  incident creation. Suppressed alerts are recorded (audited) but do not page.
- **Repository + CRUD** — `suppression_rules` collection, owner-scoped;
  `GET/POST/PUT/DELETE /api/monitor/suppressions`.

## Frontend

Two new panels on `Monitor.tsx`:
- **CorrelationPanel** — fired correlations, rule catalog toggles, suppression rules folded in.
- **FeedbackPanel** — MTTR / reopen-rate / escape-by-phase.

Anomalies surface as incidents/correlations — no separate anomaly panel.

## New Appwrite collections (user creates, same as Operate)

| Collection | Purpose | Key fields |
|---|---|---|
| `security_events` | new normalized signals (auth_failure, status_spike) | type, actor, srcIp, repoId, ownerUserId, target, severity, timestamp, metadata(JSON) |
| `correlations` | fired correlations (dedupe + UI) | ruleId, correlationKey, bucket, severity, ownerUserId, incidentId, matchedEventIds(JSON), $createdAt |
| `suppression_rules` | fatigue tuning | ownerUserId, matchType, matchValue, severity, expiresAt, reason |

C reuses existing `findings` (+ new `reopenCount` field) and `incidents`.

## Security / tenancy invariants

- Every route `verifyUser` + owner-scoped via `resolveOwnershipScope` / `canAccessResource`.
- Correlation, anomaly, and suppression all operate **within one owner scope** — no
  cross-tenant event bleed, no cross-tenant Slack (the exact bug the Operate review caught).
- Slack/incident emission fail-secure and owner-scoped.
- Suppression is recorded before it silences — no silent drops without an audit trail.

## Deferred (with reasons)

- Cloud SIEMs (Sentinel / Chronicle / Security Hub) + Splunk/ELK — buy-vs-build, out of
  app scope (same call as Loki-vs-Splunk).
- GeoIP enrichment for account-takeover — uses IP-change proxy, avoids a GeoIP-DB dependency.
- ML / UEBA anomaly baselining — rule-threshold first; YAGNI until thresholds prove noisy.
- CloudTrail ingestion for rule A-2 — `cloud_api` events come from existing runtime signals;
  live AWS ingestion is an integration, not app logic.

## Verification

Per component: unit tests on every pure function (evaluator, detector, matcher, metrics),
repository/route tests following existing `*.test.ts` patterns, `tsc --noEmit` clean, lint
clean on new files, full backend suite green. Correlation idempotency and cross-tenant
isolation get explicit tests.
