# Monitor Phase — Capabilities

How Scorpion covers Stage 8 of the DevSecOps lifecycle: multi-event attack
correlation, telemetry-driven anomaly detection, resolution-quality feedback
metrics, and alert-noise suppression. Industry reference points: SIEM
correlation rules (Splunk ES, Sentinel analytics rules), APM anomaly
detection, and DORA-style MTTR/reopen-rate feedback loops.

## New: Correlation Engine

Pure, in-memory sequence matcher that turns raw `security_events` rows into
fired `Correlation`s against a fixed 5-rule catalog — no ML, no external SIEM.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/monitor/securityEvent.types.ts` | `SecurityEvent`, `CorrelationRule`, `RuleCondition`, `Correlation`, `RuleState` types |
| `backend/src/monitor/correlationCatalog.ts` | Fixed 5-rule catalog (`CORRELATION_CATALOG`) |
| `backend/src/monitor/correlationEngine.ts` | Pure `evaluate(events, rules, now)` — groups events by rule key, finds all non-overlapping sequence matches per group |
| `backend/src/monitor/securityEventSource.ts` | `recordSecurityEvent` (write) + `collect(ownerUserId, windowMs)` (read), backed by the `security_events` collection |
| `backend/src/repositories/correlationRepository.ts` | Appwrite persistence: `wasFired`/`recordFired` (idempotency against `correlations`), `listRuleStates`/`upsertRuleState` (`correlation_rule_states`), `listFired` |
| `backend/src/queues/correlationQueue.ts` + `correlationQueueWorker.ts` | Per-owner tick loop (BullMQ, self-re-enqueuing every 60s) that runs `evaluate`, suppression, and incident creation |
| `backend/src/routes/monitorCorrelationRoutes.ts` | `GET /api/monitor/correlations`, `GET /api/monitor/correlations/rules`, `PUT /api/monitor/correlations/rules/:id` |

### Rule Catalog

| Rule id | Severity | Key | Window | Sequence |
|---|---|---|---|---|
| `account-takeover` | critical | `actor` | 10m | `auth_failure` ×5 → `auth_success` (new src IP) → `data_export` |
| `ssrf-metadata-exfil` | critical | `srcIp` | 5m | `metadata_access` (target = `169.254.169.254`) → `cloud_api` |
| `recon-to-exploit` | high | `srcIp` | 15m | `recon` → `exploit` |
| `runtime-breakout` | critical | `target` | 10m | `runtime_threat` → `outbound_unknown` |
| `gate-bypass-deploy` | high | `target` | 30m | `gate_blocked` → `deploy` |

### Matching Semantics

- Events are grouped by the rule's correlation key (`actor`/`srcIp`/`target`);
  matching runs independently per group, sorted by timestamp.
- `evaluate` finds **all** non-overlapping matches per group, not just the
  first: after a completed match or a window-timeout abort, scanning resumes
  from the next unconsumed event rather than stopping, so a later genuine
  sequence in the same group is never hidden by an earlier abort or success.
- The window anchor (`bucket`) is the first matched event's timestamp,
  floored to `windowMs` — used as the idempotency key alongside `ruleId` +
  `correlationKey` so a re-run of the same tick never double-fires.
- `newValueFor: 'srcIp'` requires the matching event's `srcIp` to differ from
  the previously-matched condition's event (e.g. login from a **new** IP) —
  this is how `account-takeover` distinguishes a legitimate retry from a
  takeover.

### Fail-Safe Semantics

- **Idempotent firing:** `wasFired` fails secure — an Appwrite read error is
  treated as "already fired" so a transient outage never double-pages.
- **Per-tenant isolation:** each owner gets its own BullMQ tick
  (`enqueueCorrelationTick({ ownerUserId })`), self-perpetuating via a
  re-enqueue at the end of `runCorrelationTick` — no shared tenant registry.
- **Tick seeding:** `GET /api/monitor/correlations` seeds that caller's tick
  loop on first view (ponytail: avoids a separate tenant-registry service).
- **Rule state fallback:** `listRuleStates` returns `[]` on read failure,
  which the worker and route both treat as "all rules enabled, no severity
  overrides" (fail-open toward *more* detection, not less).

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/monitor/correlations` | Fired correlations for the caller (`ruleId`, `title`, `severity`, `correlationKey`, `bucket`, `matchedEventIds`, `incidentId`, `createdAt`) |
| `GET /api/monitor/correlations/rules` | Catalog merged with the caller's overrides: `{ id, title, severity, enabled, windowMs }` |
| `PUT /api/monitor/correlations/rules/:id` | `{ enabled, severityOverride? }` → upserts a `correlation_rule_states` row |

---

## New: APM Status-Spike Anomaly Detection

App-global, in-memory 401/403 rate telemetry that flags a source IP sending
a disproportionate share of denied responses — a lightweight brute-force /
credential-stuffing signal that needs no external APM vendor.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/monitor/statusTelemetry.ts` | In-memory per-minute, per-key (`srcIp`) counters; bounded to 500 keys/minute; `record`, `snapshot`, `prune(now)` (5-minute retention) |
| `backend/src/middleware/requestLogger.ts` | Calls `statusTelemetry.record(ip, res.statusCode)` on every request — this is the only telemetry writer |
| `backend/src/monitor/anomalyDetector.ts` | Pure `detectStatusSpike(buckets, { minDenied, minShare })` — flags a bucket where `denied >= minDenied` and `denied/total >= minShare` |
| `backend/src/queues/correlationQueueWorker.ts` (`runCorrelationTick`) | Runs the spike check, records a `status_spike` `security_event`, and creates an `apm`-sourced incident |

### Detection Flow

1. `requestLogger` records every response's status against the caller's IP,
   bucketed by minute, in the app-global `statusTelemetry` store (not
   per-owner — there is no tenant on an unauthenticated request).
2. On the correlation worker's `system`-owner tick only, `detectStatusSpike`
   is run against `statusTelemetry.snapshot()` with thresholds
   `minDenied: 10, minShare: 0.5` (10+ denied responses, ≥50% of that
   minute's traffic from that IP).
3. Each spike is deduped in-memory by `${srcIp}:${minute}`
   (`spikeIncidentKeys`, pruned on the same 5-minute retention window as
   `statusTelemetry`) before being checked against suppression rules,
   recorded as a `status_spike` security event, and turned into a `high`
   severity, `source: 'apm'` incident.

### Why Only the `system` Tick

`statusTelemetry` is a single app-global counter with no `ownerUserId` — a
per-owner tick processing it would non-deterministically attribute a global
spike to whichever owner's tick happened to run first. `runCorrelationTick`
gates the spike check behind `ownerUserId === 'system'` so it runs exactly
once per minute, tenant-independent.

---

## New: Feedback Metrics

Pure resolution-quality calculations over existing `vulnerabilities`/
`findings` records — no new event stream, just derived DORA-style metrics.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/monitor/feedbackMetrics.ts` | Pure `mttr`, `reopenRate`, `escapeByPhase` over `FindingRecord[]` |
| `backend/src/routes/monitorFeedbackRoutes.ts` | `GET /api/monitor/feedback` — loads the caller's repos (tenancy-scoped), then findings for those repos, maps to `FindingRecord`, and runs the three pure functions |

### Metric Definitions

- **`mttr(findings)`** — average `resolvedAt - createdAt` across findings with
  `status === 'resolved'` **and** a `resolvedAt` timestamp; returns `0` if no
  such findings exist (nothing to average). Milliseconds.
- **`reopenRate(findings)`** — of findings that were ever resolved
  (`status === 'resolved'` or `reopenCount > 0`), the fraction with
  `reopenCount > 0`. Returns `0` if the denominator is empty.
- **`escapeByPhase(findings)`** — buckets findings by the lifecycle phase
  their originating scanner belongs to (`semgrep`/`bandit`/`trivy`/`gitleaks`
  → `build`; `zap`/`nuclei`/`ffuf` → `test`; `checkov` → `deploy`; `falco` →
  `operate`; anything else → `unknown`) and counts them per phase.

### Runtime Dependency

`mttr` and `reopenRate` are populated **only** when findings carry
`resolvedAt` and `reopenCount`. Both attributes are new on the
`vulnerabilities` collection (see Runtime Prerequisites below) — a resolve
action that does not stamp `resolvedAt` leaves that finding permanently
excluded from the MTTR average.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/monitor/feedback` | `{ mttr: number, reopenRate: number, byPhase: { phase: string, count: number }[] }`. Returns `{ mttr: 0, reopenRate: 0, byPhase: [] }` if the caller has no repositories. |

---

## New: Alert Suppression

Pure, tenant-scoped match rules that silence correlation and APM-spike
incidents by rule id, severity, repo, or actor — without disabling the
underlying detection.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/monitor/suppressionMatcher.ts` | Pure `isSuppressed(candidate, rules, now)` — first matching, non-expired rule wins |
| `backend/src/repositories/suppressionRepository.ts` | Appwrite persistence (collection: `suppression_rules`); `remove` enforces an owner check before delete |
| `backend/src/routes/monitorSuppressionRoutes.ts` | `GET/POST /api/monitor/suppressions`, `DELETE /api/monitor/suppressions/:id` |
| `backend/src/queues/correlationQueueWorker.ts` | Calls `isSuppressed` for both the APM spike path and the correlation-fired path before creating an incident |

### Match Semantics

- `matchType` ∈ `ruleId` \| `severity` \| `repo` \| `actor` — compared against
  the candidate's corresponding field (`ruleId`, `severity`, `repoId`,
  `actor`).
- `expiresAt` (epoch ms, optional) — a rule with `expiresAt <= now` is
  skipped, so time-boxed suppressions expire without manual deletion.
- Suppression happens **before** incident creation, not before security-event
  recording — the underlying event is still written (and still fires
  correlation matches), only the resulting incident/page is dropped. This
  keeps suppressed activity visible in the fired-correlations history.
- `suppressionRepository.remove` re-fetches the document and checks
  `owner === callerId` before deleting — a suppression id from another
  tenant returns `404`, not a cross-tenant delete.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/monitor/suppressions` | List the caller's suppression rules |
| `POST /api/monitor/suppressions` | `{ matchType, matchValue, expiresAt?, reason? }` → `201` with the created rule; `400` if `matchType` is not one of the four values or `matchValue` is missing |
| `DELETE /api/monitor/suppressions/:id` | `404` if the id doesn't belong to the caller |

---

## Frontend

| Component | Purpose |
|---|---|
| `src/components/CorrelationPanel.tsx` | Fired correlations list, rule-catalog enable/disable toggles, suppression list + create/delete form |
| `src/components/FeedbackPanel.tsx` | MTTR (formatted h/m), reopen rate (%), escapes-by-phase bar chart (Recharts, reusing the library already used elsewhere in `Monitor.tsx`) |

Both are mounted on `src/pages/Monitor.tsx` in the "Operate" section, after
`NetPolPanel`. They follow the same auth-fetch (`getJWT` → `Bearer` header),
loading/error/empty-state, and `premium-card` styling conventions as the
sibling `FalcoRulesPanel`/`PosturePanel` components — no new visual pattern
was introduced.

---

## Known Limitations

1. **Four of five correlation rules are latent.** The correlation engine and
   catalog are fully implemented and tested, but a rule only fires once its
   event types actually reach the `security_events` collection. Today,
   `recordSecurityEvent` is called from exactly two call sites:
   - `backend/src/queues/correlationQueueWorker.ts` — `status_spike` events
     (APM anomaly detection, described above).
   - `backend/src/routes/authRoutes.ts` (`reset-password`, `JsonWebTokenError`
     branch) — a single `auth_failure` event, `severity: medium`,
     `ownerUserId: 'system'`, emitted only for an invalid/expired
     password-reset token.

   No code path currently emits `auth_success`, `data_export`,
   `metadata_access`, `cloud_api`, `recon`, `exploit`, `runtime_threat`,
   `outbound_unknown`, `gate_blocked`, or `deploy` events. Concretely:
   - `account-takeover` needs `auth_failure` ×5 + `auth_success` (new IP) +
     `data_export`. Login is handled client-side via the Appwrite SDK
     (`src/contexts/AuthContext`), so the backend never observes a login
     attempt — success or failure. The only `auth_failure` source today is
     the reset-password path, and there is no `auth_success` or
     `data_export` emitter at all, so this rule is structurally unable to
     fire until a server-side auth event hook is added.
   - `ssrf-metadata-exfil`, `recon-to-exploit`, `runtime-breakout`, and
     `gate-bypass-deploy` are fully coded against `SecurityEventType`s that
     have no producer yet (would need, respectively: an outbound-request
     interceptor for metadata/cloud-API calls, a WAF/IDS-style recon+exploit
     classifier, a Falco-fed runtime-threat bridge, and a gate-to-deploy
     pipeline hook).

   The engine, catalog, rule-toggle UI, and suppression path are all
   real and tested against synthetic events (see
   `backend/src/monitor/correlationEngine.test.ts`); what's deferred is
   wiring the remaining event producers, not the correlation logic itself.

2. **Status-spike → APM incident is the one live, end-to-end working
   detection.** It is processed only on the app-global `system` tick (see
   "Why Only the `system` Tick" above) — per-owner ticks still run
   `evaluate()` against whatever real events exist in `security_events` for
   that owner (today: only the reset-password `auth_failure`), but will not
   produce a completed correlation until more producers exist.

3. **Tasks-page resolutions do not feed MTTR / reopen-rate.** The frontend's
   `COLLECTIONS.FINDINGS` resolves via `.env`
   (`VITE_APPWRITE_FINDINGS_COLLECTION_ID=findings`) to the separate
   `findings` collection (docker-scan findings), while the feedback route
   computes its metrics over `vulnerabilities` — the collection the main
   scan pipeline populates. So the `resolvedAt` stamp on
   `src/pages/TasksPage.tsx` lands in a collection the metrics never read;
   only the `src/components/VerifyScan.tsx` auto-close path (which writes to
   `COLLECTIONS.VULNERABILITIES`) currently feeds MTTR. This is a
   pre-existing frontend collection-alias split, not introduced by this
   phase. Follow-up: repoint the Tasks page's reads *and* writes to
   `vulnerabilities` (or unify the two aliases) so manual resolutions count.

---

## Deliberately deferred

- **Server-side login telemetry** — would require either an Appwrite
  webhook/function on auth events or moving login through a backend proxy;
  both are larger architectural changes than this phase's scope, and the
  reset-password path was chosen as a lower-risk first `auth_failure`
  source.
- **Cross-tenant / global correlation** — each owner's events are evaluated
  independently; a multi-tenant attack pattern spanning owners is out of
  scope.
- **Configurable anomaly thresholds** — `minDenied`/`minShare` for the
  status-spike detector are hardcoded (`10`, `0.5`); a per-owner tuning UI is
  deferred.

---

## Runtime Prerequisites (Appwrite Collections)

Test suites fully mock Appwrite, so tests pass without these collections;
production requires them to be created in the Appwrite console before the
Monitor phase features work end-to-end. Fields marked json-string hold
`JSON.stringify`'d data, parsed back on read.

| Collection | Attributes |
|---|---|
| `security_events` | `type` (string), `actor` (string, nullable), `srcIp` (string, nullable), `repoId` (string, nullable), `ownerUserId` (string), `target` (string, nullable), `severity` (string), `timestamp` (int), `metadata` (string, json-string) |
| `correlations` | `owner` (string), `ruleId` (string), `correlationKey` (string), `bucket` (int), `severity` (string), `incidentId` (string), `matchedEventIds` (string, json-string) |
| `correlation_rule_states` | `owner` (string), `ruleId` (string), `enabled` (bool), `severityOverride` (string, nullable) |
| `suppression_rules` | `owner` (string), `matchType` (string), `matchValue` (string), `expiresAt` (int, nullable), `reason` (string, nullable) |

Additionally, add two new attributes to the existing `vulnerabilities`
collection (both optional so existing rows remain valid):

| Attribute | Type | Notes |
|---|---|---|
| `reopenCount` | int, default `0` | Incremented whenever a resolved finding is reopened; feeds `reopenRate` |
| `resolvedAt` | datetime, nullable | Set by the frontend resolve actions (`TasksPage.tsx`, `VerifyScan.tsx`) when a finding transitions to `status: 'resolved'`; feeds `mttr` |

Without `resolvedAt` populated, `mttr` and `reopenRate` will report `0`
indefinitely even with resolved findings in the database — this is why the
resolve-action call sites were updated in this same change to stamp
`resolvedAt` on every resolve.
