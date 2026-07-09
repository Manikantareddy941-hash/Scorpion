# Operate Phase — Capabilities

How Scorpion covers Stage 5 of the DevSecOps lifecycle: runtime threat detection,
automated containment, and security posture validation. Industry reference points:
Falco/Sysdig (threat detection), Cloud Custodian/Prowler (CSPM), SOAR platforms
(orchestrated response), Istio/Cilium (zero-trust networking).

## What already existed

| Capability | Where | Notes |
|---|---|---|
| Falco rule ingestion | `backend/src/routes/falcoRoutes.ts` → `runtime/falcoHandler.ts` | Falco events webhook → classification → incident + Slack alert |
| Runtime drift monitor | `backend/src/workers/driftMonitor.ts` | Pod spec validation against deploy-time gate rules |

Scorpion deliberately **integrates with** Falco event streams rather than operating
the Falco agent itself — the security seam is the webhook, not the sensor.

## New: SOAR (Security Orchestration, Automation, Response)

Playbook-driven, owner-scoped automated response to classified incidents. Response
actions are orchestrated, logged, and fail-safe: a failed action does not block
the incident or trigger cascading re-runs.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/routes/playbooks/playbookRoutes.ts` | CRUD: create, list, get playbook definitions |
| `backend/src/repositories/playbookRepository.ts` | Appwrite persistence (collection: `playbooks`, cluster-scoped) |
| `backend/src/services/playbookMatcher.ts` | Pure predicate matcher: event + rule → playbook candidates |
| `backend/src/queues/soarQueue.ts` + `soarQueueWorker.ts` | Delayed job orchestration (BullMQ, restart-safe) |
| `backend/src/services/soarActions.ts` | Action primitives: `slack_escalate`, `isolate_pod`, extensible |
| `backend/src/repositories/soarRepository.ts` | Action audit log (collection: `soar_actions`, incl. `ownerUserId` string) |

### API and Configuration

**Playbooks** (`POST/GET/PUT /api/playbooks`, cluster-scoped):
```json
{
  "name": "critical-network-anomaly",
  "rules": [{ "event_type": "network-exploit", "severity": "critical" }],
  "actions": [
    { "type": "slack_escalate", "severity_threshold": "high", "channels": ["#soc"] },
    { "type": "isolate_pod", "mode": "soft" }
  ]
}
```

**Action Audit Log** (`GET /api/soar-actions[/:id]`): per-action execution trace
with timestamps, payloads, and success/failure reason.

### Fail-Safe Semantics

- **Owner-scoped escalation:** `slack_escalate` action broadcasts to Slack channels
  belonging to the playbook owner (ownerUserId), never cluster-wide. No owner = no
  broadcast (fail-secure).
- **Pod isolation via RFC 6902 JSON Patch:** `isolate_pod` applies surgical
  net-deny NetworkPolicies using JSON Patch (add/remove label selectors) rather
  than replacing the entire pod spec — reversible, minimal blast radius.
- **Dispatch timing:** SOAR orchestration starts **after** the alerting path
  completes (incident + Slack incident alert sent) — containment never delays
  incident detection to the SOC.
- **Post-action status updates:** If an action succeeds but the subsequent
  status-write to the action log fails, the action is **not** re-run — the
  destructive work already happened; logging failures do not cascade.

---

## New: Falco Runtime Rules (Enhanced)

Refactored rule system: classification-gated incident creation, renderer fail-secure,
and unknown-rule suppression guarantees.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/routes/falcoRuleRoutes.ts` | CRUD + bulk export: get, list, create rules |
| `backend/src/repositories/falcoRuleRepository.ts` | Appwrite persistence (collection: `falco_rules`) |
| `backend/src/services/falcoRuleCatalog.ts` | In-memory rule registry with app/global scope resolution |
| `backend/src/runtime/falcoHandler.ts` (lines ~67–97) | Webhook entry: classify, filter, create incident |

### Classification Gate (Exception-Safe)

When a Falco event arrives:
1. Lookup rule by event type in `falcoRuleCatalog`
   - Prefer **app-scoped** rule over global (rule inheritance tree)
   - Malformed rules in the catalog **never block** incident creation
   - Unknown rules are **never suppressed** — if a rule is absent, the event
     promotes to an incident anyway (assume high-severity until proven otherwise)
2. Apply classification verdict (level, category, CIS control mapping)
3. Create incident with classified metadata

### Renderer Fail-Secure

The event renderer (Falco plugin system) may fail to extract named parameters
(e.g., `SAFE_PARAM` fields are dropped if the Falco schema evolves). When rendering:
- SAFE_PARAM values missing from the event JSON → field is omitted from the
  rendered alert, never substituted with a placeholder or error string
  (fail-secure: fail to a lower-signal alert, not a false positive)

### API and Audit

**Rules** (`GET/POST /api/falco-rules`, app/global scoped):
```json
{
  "name": "malicious-socket-creation",
  "event_type": "security_event_write",
  "level": "warning",
  "category": "network_activity",
  "scope": "app",  // or "global"
  "cis_control": "6.1"
}
```

**Bulk Export** (`GET /api/falco-rules/export`): JSON array of all active rules
for backup or cross-cluster replication.

---

## New: CSPM (Cloud Security Posture Management)

Read-only posture scanner: validates Kubernetes cluster resource configurations
against security baselines, logs results per namespace.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/routes/postureRoutes.ts` | GET posture snapshots and per-namespace scores |
| `backend/src/repositories/postureRepository.ts` | Appwrite snapshot persistence (collection: `posture_snapshots`) |
| `backend/src/services/postureScanner.ts` | Pure rule-based scanner: crawl cluster → evaluate checks → score |
| `backend/src/workers/postureWorker.ts` | Scheduled jobs (BullMQ, daily by default) |

### Capabilities

**Posture checks** (pure evaluation, no side effects):
- Pod Security Standards (privileged, capability grants, etc.)
- Network policies (deny-all, segmentation)
- RBAC (least-privilege bindings, service account usage)
- Secrets (none in Env, all in mounted volumes)
- CIS Kubernetes Benchmarks (subset)

**Per-namespace snapshots** (read-only):
```json
{
  "namespace": "prod",
  "timestamp": "2026-07-09T14:30:00Z",
  "score": 72,
  "issues": [
    { "check_id": "pss-privileged", "severity": "critical", "count": 2 }
  ]
}
```

### Fail-Safe Semantics

- **Read-only:** Scanner never modifies cluster state; all endpoints are GET-only.
- **Snapshot persistence:** When saveSnapshot calls Appwrite, errors are logged
  and **rethrown** to the caller; the job fails visibly and can retry (not silently
  dropped).
- **Listing snapshots:** If Appwrite is unreachable, `listSnapshots` returns an
  empty array with a logged warning (fail-secure: better to show "no data" than
  to crash the UI).
- **No cloud-API scanning:** CSPM is restricted to Kubernetes API only; cloud
  resource scanning (AWS IAM, GCP service accounts, Azure RBAC) is explicitly
  deferred to a separate cloud-vendor-credentialed scanner.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/posture` | List all namespace snapshots, sorted by most recent |
| `GET /api/posture/:namespace` | Get latest snapshot for a namespace |

---

## New: NetworkPolicy Zero-Trust Generator

Declarative generator for deny-all + explicit allow policies (zero-trust pattern).
Policies are generated as artifacts (GitHub PR, local JSON) but **never applied
directly to the cluster** — the deployment gate owns the apply step.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/routes/networkPolicyRoutes.ts` | POST to generate, GET to list artifacts |
| `backend/src/services/networkPolicyGenerator.ts` | Pure policy generation: namespace → deny-all + allow flows |
| `backend/src/gitops/netpolPr.ts` | GitHub PR workflow: create/update PR with generated policies |

### Generation Flow

1. **Input:** namespace, list of allowed traffic flows
   ```json
   {
     "namespace": "payments",
     "flows": [
       { "from_app": "api-gateway", "to_app": "payment-service", "ports": [8080] },
       { "from_app": "payment-service", "to_app": "postgres", "ports": [5432] }
     ],
     "allow_dns": true
   }
   ```

2. **Validation:**
   - Namespace name must match DNS-1123 (alphanumeric + dash, 1–63 chars)
     → throws 400 on invalid namespace
   - Invalid flows (unknown apps, out-of-range ports) are skipped with a warning
     (fail-secure: drop the flow, proceed with valid ones)

3. **Policy generation:**
   - Deny-all ingress + egress baseline
   - Per-flow allow rules with pod label selectors
   - DNS egress allow (kube-system/coredns)
   - Policy names suffixed with port ranges (e.g., `deny-all-8080-5432`)

4. **Artifacts:**
   - YAML manifests saved locally or to a PR branch
   - Policies are **never applied**; deployment approval workflow applies them

### Fail-Secure Defaults

- **Deny-all baseline:** Every policy defaults to deny-all, then whitelist (zero-trust)
- **Invalid flows skipped:** Malformed flow specs do not halt generation; valid flows proceed
- **Namespace validation:** DNS-1123 check is strict; invalid namespaces fail fast (400)
- **No direct cluster writes:** Policies are artifacts only; cluster apply is
  gated by deploy-phase approval

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/netpol/generate` | Generate policies for a namespace |
| `GET /api/netpol/artifacts` | List generated policy artifacts |
| `POST /api/netpol/artifacts/:id/pr` | Create GitHub PR with policies |

---

## Deliberately deferred

- **Cloud-API CSPM** — Cloud Custodian/Prowler integration requires cloud
  provider credentials (AWS STS, GCP service account, Azure RBAC); deferred to a
  separate, credentialed scanning phase.
- **Service mesh installation & management** — Istio/Cilium bring their own
  deployment complexity; the NetworkPolicy generator produces manifests for
  cluster admins to apply, not an installed mesh.
- **Arbitrary Falco rule authoring** — Falco rules are SQL-like, require kernel
  probe knowledge, and are high-blast-radius; the rule catalog is a curated list.
  Custom rule development is a deferred, documented-separately workflow.
- **Direct cluster remediation outside SOAR** — Pod mutations, node cordons, and
  workload migrations outside the orchestrated response playbook framework are
  out of scope; operator control flow through SOAR is the model.
- **Multi-cluster SOAR coordination** — Response actions target the local cluster
  only; cross-cluster incident correlation is deferred.

---

## Appwrite Collections (Required at Runtime)

The scanner and SOAR orchestrator depend on these collections. Test suites
fully mock Appwrite, so tests pass without them; production requires these
collections to be pre-created in the Appwrite console:

| Collection | Required Columns |
|---|---|
| `playbooks` | `name` (str), `rules` (json), `actions` (json), `owner_id` (str), `created_at` (datetime) |
| `soar_actions` | `playbook_id` (str), `incident_id` (str), `action_type` (str), `status` (str), `ownerUserId` (str), `payload` (json), `result` (json), `created_at` (datetime) |
| `falco_rules` | `name` (str), `event_type` (str), `level` (str), `category` (str), `scope` (str), `cis_control` (str), `created_at` (datetime) |
| `posture_snapshots` | `namespace` (str), `timestamp` (datetime), `score` (int), `issues` (json), `created_at` (datetime) |
