# Deploy Phase (Stage 6) — Design

**Date:** 2026-07-04
**Branch:** `feat/deploy-phase`
**Status:** Approved

## Context

Scorpion already covers most of the Deploy phase: ArgoCD sync webhook
(`gitopsRoutes` → `argocdHandler`: scan → per-repo policy gate → incident →
auto-rollback PR → Slack), a real fail-secure ValidatingWebhook
(`k8sAdmission`: cosign signature check + vuln/reachability preflight),
drift detection, and Checkov IaC scanning.

Two real gaps remain versus an industry Deploy phase
(Kyverno/Gatekeeper-class admission control, Flagger/Argo-Rollouts-class
progressive delivery):

1. The admission webhook is **image-only** — it ignores the pod spec it
   already receives. No registry allowlist, no pod-security checks.
2. **No progressive delivery** — rollback exists but is scan-triggered,
   never metric-driven. No canary analysis at all.

Out of scope (deliberate): a pull-based GitOps sync agent (ArgoCD clone —
the existing ArgoCD integration sits at the correct seam), real traffic
shifting (the service mesh / ALB's job, same split Flagger uses), and
arbitrary YAML policy authoring (a fixed rule catalog covers the need).

## Component 1: Pod-security admission policies (Kyverno-style)

Extends the existing `k8sAdmission` webhook. Same AdmissionReview request,
more checks.

### Rule catalog (fixed)

| Rule id | Blocks when |
|---|---|
| `registry-allowlist` | any container image is not from an approved registry prefix |
| `no-privileged` | any container sets `securityContext.privileged: true` |
| `run-as-non-root` | pod/container does not enforce `runAsNonRoot: true` |
| `drop-dangerous-capabilities` | container adds `SYS_ADMIN`, `NET_ADMIN`, `SYS_PTRACE`, or `ALL` |
| `read-only-root-fs` | container lacks `readOnlyRootFilesystem: true` |
| `no-host-namespaces` | pod sets `hostNetwork`, `hostPID`, `hostIPC`, or mounts a `hostPath` volume |
| `required-labels` | pod is missing configured required labels (e.g. `team`, `app`) |

### Evaluation

- Pure function `evaluatePodSecurity(podSpec, rules)` → `Violation[]`.
  Zero I/O, mirrors the existing `evaluatePreflight` shape, fully
  unit-tested.
- Check order in the webhook: signature check → pod-security → vuln
  preflight (cheap/static checks before scan-backed ones).
- Deny message lists **every** violated rule (Kyverno-style), e.g.
  `Deployment blocked: image 'nginx:latest' not from approved registry; container 'app' runs privileged`.

### Configuration

- Per-env (dev/staging/prod), per-rule mode: `enforce` | `audit` | `off`.
  `audit` logs the violation and allows.
- Rule config + registry allowlist + required-labels list stored in
  Appwrite, loaded per request following the existing
  `loadRulesOrFailClosed` pattern.
- **Fail-secure:** config load failure in prod → block (consistent with
  the existing webhook behavior).
- Sensible defaults when no config exists: audit-mode everything except
  `no-privileged` (enforce) so first install never bricks a cluster.

### UI

Small panel (Deploy section): rule list with per-env mode toggles, plus
registry-allowlist and required-labels inputs.

## Component 2: Canary analysis controller (Flagger-style)

New subsystem. Scorpion is the analysis/decision brain; traffic routing
stays with the mesh/ALB. Metric-driven auto-rollback reuses the existing
`triggerRollback` → incident → Slack flow from `argocdHandler`.

### Model

Canary release document (Appwrite collection `canaries`):

```
{ app, namespace, image,
  stableRevision, canaryRevision,
  thresholds: { maxErrorRatePct, maxP95LatencyMs? },
  intervalSec, maxFailures, requiredChecks,
  status: 'running' | 'promoted' | 'rolled_back' | 'aborted',
  checks: [{ at, errorRatePct, p95LatencyMs, passed, reason }],
  consecutiveFailures }
```

### Analysis loop

- BullMQ `canaryQueue` + worker, copying the `dastQueue` pattern
  (restart-safe, retries, bounded). One delayed job per tick; each tick
  re-enqueues the next until a terminal state.
- Each tick queries Prometheus (`PROMETHEUS_URL`, already in the Monitor
  stack) for the app's error rate (and p95 latency when a threshold is
  set), records a check entry, and updates the counter.

### Decision logic (pure function, unit-tested)

- Check fails when any threshold is breached **or the metric query
  errors/returns no data** (fail-secure: no metrics → no judgment → count
  as failure).
- `consecutiveFailures >= maxFailures` → status `rolled_back`, call
  `triggerRollback`, create incident, Slack alert.
- `requiredChecks` consecutive passes → status `promoted`.
- A pass resets `consecutiveFailures`.

### API

- `POST /api/canary` — start (validated payload, auth like sibling routes)
- `GET /api/canary` / `GET /api/canary/:id` — list / status + check history
- `POST /api/canary/:id/abort` — manual abort (terminal, no rollback PR)

### UI

Canary panel: active canaries with live status, check timeline
(pass/fail per tick with metrics), promoted / rolled-back badges,
abort button.

## Error handling

- Webhook: all new checks inside the existing fail-secure envelope;
  malformed pod specs are a violation, not a crash.
- Canary worker: Prometheus errors are failed checks, never unhandled
  rejections; worker retries are bounded; terminal states stop the loop.
- Routes: payload validation at entry, 4xx with clear messages.

## Testing

- Unit: `evaluatePodSecurity` (every rule, enforce/audit/off, malformed
  specs), canary decision function (breach, recovery, promote,
  metric-unavailable).
- Routes: canary route tests following existing `*.test.ts` patterns;
  admission webhook tests extending `k8sAdmission.signature.test.ts`
  style.
- Per chunk: `tsc --noEmit`, lint, full backend suite green.

## Build order

1. `evaluatePodSecurity` + tests (pure, no wiring)
2. Wire into webhook + config load + defaults + webhook tests
3. Admission rules UI panel
4. Canary decision function + tests (pure)
5. Canary service + queue/worker + routes + tests
6. Canary UI panel
7. Docs: `docs/lifecycle/deploy-phase.md`
