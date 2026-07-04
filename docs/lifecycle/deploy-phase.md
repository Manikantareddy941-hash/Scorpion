# Deploy Phase — Capabilities

How Scorpion covers Stage 6 of the DevSecOps lifecycle: a secure, verifiable
transition into production. Industry reference points: ArgoCD/Flux (GitOps),
Kyverno/OPA Gatekeeper (admission control), Flagger/Argo Rollouts
(progressive delivery).

## What already existed

| Capability | Where | Notes |
|---|---|---|
| GitOps deploy gate | `backend/src/routes/gitopsRoutes.ts` → `gitops/argocdHandler.ts` | ArgoCD sync webhook (shared-secret, fail-closed) → Trivy image scan → per-repo policy gate → incident + **auto-rollback PR** + Slack |
| Admission webhook (image gate) | `backend/src/routes/k8sAdmission.ts` | Real ValidatingWebhook: cosign signature check (opt-in, prod, fail-secure) + vuln/reachability preflight, 2s budget, fail-closed in prod |
| Rollback PRs | `backend/src/gitops/rollbackService.ts` | GitHub App opens a revert-to-safe-commit PR |
| Runtime drift monitor | `backend/src/workers/driftMonitor.ts` | Re-validates running pods against the same gate rules |
| IaC scanning | Checkov via the scan orchestrator | Deploy manifests scanned pre-merge |

Scorpion deliberately **integrates with** ArgoCD rather than reimplementing it
— the security seam is the sync event, not the sync engine.

## New: Pod-security admission policies (Kyverno-style)

The webhook previously judged only images. It now also judges the pod spec it
already receives, before the scan-backed image gate (cheap checks first).
Check order: **signature → pod-security → vulnerability/reachability**.

| Rule id | Blocks when |
|---|---|
| `registry-allowlist` | container image not from an approved registry prefix (inert while the allowlist is empty) |
| `no-privileged` | `securityContext.privileged: true` |
| `run-as-non-root` | neither pod nor container asserts `runAsNonRoot: true` |
| `drop-dangerous-capabilities` | adds `SYS_ADMIN`, `NET_ADMIN`, `SYS_PTRACE`, or `ALL` |
| `read-only-root-fs` | container lacks `readOnlyRootFilesystem: true` |
| `no-host-namespaces` | `hostNetwork`/`hostPID`/`hostIPC` or a `hostPath` volume |
| `required-labels` | configured label keys missing (inert while the list is empty) |

- Per-rule mode: `enforce` (deny, all violations listed in the message),
  `audit` (admit, `[audit]` warning in the response), `off`.
- Defaults: everything `audit` except `no-privileged` (`enforce`) — a fresh
  install never bricks a cluster.
- Config: cluster-scoped (same SYSTEM-user convention as the gate rules),
  Appwrite-backed with local-JSON fallback + replayer
  (`podSecurityRepository`), **fail-closed in prod** when unloadable.
- API: `GET/PUT /api/v1/rules/pod-security`. UI: Pod Security Policies panel
  on the Deploy page.
- Core: pure `evaluatePodSecurity` in
  `backend/src/services/podSecurityService.ts` (29 unit tests, zero I/O).

## New: Canary analysis controller (Flagger-style)

Progressive delivery brain: Scorpion analyzes a canary release under live
traffic and decides continue / promote / rollback. Traffic shifting itself
stays with the mesh/ALB — the same division of labor Flagger uses with Istio.

Flow per tick (BullMQ `canary-analysis` queue, restart-safe, delayed jobs):

1. Query Prometheus (`PROMETHEUS_URL`) for the app's 5xx error rate and p95
   latency over 5m windows.
2. Pure decision core (`canaryAnalysis.ts`): threshold breach **or missing
   metric** = failed check (fail-secure: no data, no judgment).
3. `consecutiveFailures ≥ maxFailures` → **auto-rollback**: rollback PR
   (best-effort) + gitops incident + Slack + status `rolled_back`.
4. `passedChecks ≥ requiredChecks` → status `promoted`.
5. Otherwise persist progress and schedule the next tick.

- API: `POST /api/canary` (start), `GET /api/canary[/:id]`,
  `POST /api/canary/:id/abort` (owner-only, no rollback PR).
- Audit trail: `canary.started/promoted/rolled_back/aborted`.
- UI: Canary Analysis panel on the Deploy page — status badges, pass/fail
  check timeline with reasons, abort.

### Environment variables

| Var | Purpose |
|---|---|
| `PROMETHEUS_URL` | Metric source for canary checks. Unset → every check fails secure (a canary cannot promote without evidence). |
| `K8S_GATE_RULES_USER_ID` | Owner of cluster-scoped gate + pod-security config (default `system`). |
| `REQUIRE_IMAGE_SIGNATURE` | Pre-existing: opt-in cosign gate in prod. |

## Deliberately deferred

- **Traffic shifting / weighted routing** — belongs to the mesh or load
  balancer; Scorpion is the decision plane, not the data plane.
- **GitOps pull agent (ArgoCD clone)** — the ArgoCD integration seam already
  gives the security value; a sync engine adds weeks of work and no security.
- **Arbitrary YAML/Rego policy authoring for admission** — the fixed rule
  catalog covers the Pod Security Standards surface; per-repo OPA/Rego already
  exists in the release gate (PolicyBuilder).
- **Per-namespace policy scoping** — config is cluster-scoped like the gate
  rules; prod-vs-lower-env asymmetry is handled by fail-closed semantics.
