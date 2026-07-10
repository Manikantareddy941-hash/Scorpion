# Operate Phase — Capabilities

How Scorpion covers Stage 7 of the DevSecOps lifecycle: runtime threat detection,
automated containment, and security posture validation. Industry reference points:
Falco/Sysdig (threat detection), Cloud Custodian/Prowler (CSPM), SOAR platforms
(orchestrated response), Cilium/Calico (zero-trust NetworkPolicy).

## What already existed

| Capability | Where | Notes |
|---|---|---|
| Falco rule ingestion | `backend/src/routes/falcoRoutes.ts` → `runtime/falcoHandler.ts` | `POST /api/runtime/event` (shared-secret, fail-closed) → incident + Loki + metrics + Slack for Critical/Error |
| Runtime drift monitor | `backend/src/workers/driftMonitor.ts` | Polls running pods, re-validates against the same gate rules the admission webhook uses |

Scorpion deliberately **integrates with** Falco event streams rather than operating
the Falco agent itself — the security seam is the webhook, not the sensor.

## New: SOAR (Security Orchestration, Automation, Response)

Playbook-driven, owner-scoped automated response to classified incidents. Response
actions are orchestrated, logged, and fail-safe: a failed action does not block
the incident or trigger cascading re-runs.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/soar/playbookMatcher.ts` | Pure decision core: event + playbooks → matched actions, tiered auto/approval |
| `backend/src/repositories/soarRepository.ts` | Appwrite persistence: `playbooks` (definitions) + `soar_actions` (audit log) |
| `backend/src/queues/soarQueue.ts` + `soarQueueWorker.ts` | Delayed job orchestration (BullMQ, restart-safe) |
| `backend/src/soar/soarActions.ts` | Action primitives: `capture_evidence`, `slack_escalate`, `isolate_pod`, `kill_pod` |
| `backend/src/routes/soarRoutes.ts` | CRUD for playbooks, action listing, approve/reject |
| `backend/src/runtime/falcoHandler.ts` (`dispatchSoar`) | Matches playbooks post-classification, creates `soar_actions` rows, enqueues auto actions |

### API

**Playbooks** (`GET/POST /api/soar/playbooks`, `PATCH /api/soar/playbooks/:id`,
role-gated admin/security):
```json
{
  "name": "critical-shell-response",
  "enabled": true,
  "trigger": { "rulePattern": "Terminal shell*", "minPriority": "Warning" },
  "actions": [
    { "type": "slack_escalate", "mode": "auto" },
    { "type": "isolate_pod", "mode": "approval" }
  ]
}
```

**Actions** (`GET /api/soar/actions?status=pending`,
`POST /api/soar/actions/:id/approve` / `:id/reject`): action audit trail with
`incidentId`, `playbookId`, `status`, `namespace`/`podName`, `ownerUserId`,
`result`/`error`. Approving/rejecting a non-`pending` action returns `409`
instead of double-executing.

### Fail-Safe Semantics

- **Tiered execution:** destructive actions (`isolate_pod`, `kill_pod`) auto-run
  only when the playbook action is `mode: 'auto'` **and** the event priority is
  Critical or higher; otherwise the action is created `pending` for one-click
  approve/reject. Non-destructive actions always run.
- **Owner-scoped escalation:** `slack_escalate` looks up Slack integrations by
  `ownerUserId` and fails (`ok: false`) with no owner — never broadcasts
  cluster-wide.
- **Pod isolation via RFC 6902 JSON Patch:** `isolate_pod` ensures a
  label-scoped deny-all NetworkPolicy exists, then patches the pod's labels
  with a JSON Patch `add` on `/metadata/labels` (the k8s client always
  negotiates `application/json-patch+json` for patch calls) — reversible,
  minimal blast radius.
- **Dispatch timing:** `dispatchSoar` runs **after** incident creation and the
  Critical/Error Slack alert in `falcoHandler` — containment never delays
  incident detection to the SOC; dispatch errors are swallowed so a SOAR
  failure never breaks the alerting path.
- **Idempotency backstop:** `processSoarJob` only executes actions with
  status `approved`; a retried or duplicated job against an already-executed
  action is a no-op, never a second `kill_pod`.
- **Successful-execution status write:** if an action executes but the
  subsequent `setActionStatus('executed')` write fails, the error is logged
  and swallowed rather than rethrown — a rethrow would make BullMQ retry
  against a record still marked `approved`, re-running an already-executed
  destructive action.
- **Failed-execution path:** on execution failure, `createIncident` runs
  **before** `setActionStatus('failed')` (each wrapped so one failing can't
  suppress the other). Marking the action `failed` first would make a
  retried job see status `failed`, skip re-processing, and never create the
  "containment failed" incident — reordering keeps the fail-loud incident
  from being lost.
- **Malformed playbook rows:** a playbook document with unparseable
  `trigger`/`actions` JSON is skipped (logged) rather than aborting the whole
  list — one bad row no longer takes every playbook offline.
- **Read paths:** `listPlaybooks`/`listActions` return `[]` when Appwrite is
  down (fail-secure: no playbooks matched, no SOAR actions fire); the
  pre-existing incident/alert path is unaffected.

---

## New: Falco Runtime Rules (Enhanced)

Rule catalog with per-app tuning, suppression, and classification-gated
ingestion. Scorpion renders and exports rules; it never pushes them into the
Falco agent.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/routes/falcoRuleRoutes.ts` | CRUD + YAML export |
| `backend/src/repositories/falcoRuleRepository.ts` | Appwrite persistence (collection: `falco_rules`) |
| `backend/src/runtime/falcoRuleCatalog.ts` | Fixed template catalog, `renderFalcoRules`, `classifyEvent` |
| `backend/src/runtime/falcoHandler.ts` (classification gate, before incident creation) | Webhook entry: classify → suppress/override → incident |

### Classification Gate (Exception-Safe)

When a Falco event arrives, `falcoHandler` loads managed rules and calls
`classifyEvent`:
1. Match by rule name (case-insensitive) **and** optional `appScope` container
   image prefix; a scoped match wins over a global one regardless of array
   order.
2. `suppressed: true` → the event is audit-logged and dropped — no incident,
   no playbook dispatch.
3. `severityOverride` (if set) replaces the event priority before incident
   creation and playbook matching.
4. **Unknown rules are never suppressed** — no matching managed rule means the
   event proceeds unmodified.
5. Any error in this step (catalog load, malformed rule) is caught and the
   event proceeds with its original priority — classification must never
   block incident creation.

### Rule Interpolation Safety

Template conditions interpolate user-supplied `allowedProcs`/`allowedDomains`/
`watchedPaths` values. `SAFE_PARAM` (`/^[A-Za-z0-9_./-]+$/`) whitelists those
values before they reach the generated Falco condition string; anything else
(colons, parens, quotes, newlines) is silently dropped rather than rendered —
one bad allowlist entry would otherwise risk corrupting the condition syntax
for the **entire** rules file. Dropping the entry is the fail-secure
direction: it means more alerting, not less.

### API

```json
{
  "template": "terminal-shell-in-container",
  "params": { "allowedProcs": ["bash"] },
  "appScope": "registry.example.com/payments",
  "severityOverride": "Critical",
  "suppressed": false,
  "enabled": true
}
```

| Endpoint | Purpose |
|---|---|
| `GET /api/falco-rules` | List managed rules + the fixed template catalog |
| `GET /api/falco-rules/export` | Rendered `falco_rules.local.yaml` for ConfigMap sync |
| `POST /api/falco-rules` | Create a rule (role-gated admin/security) |
| `PATCH /api/falco-rules/:id` | Update a rule |

---

## New: CSPM (Cloud Security Posture Management)

Read-only posture scanner: validates Kubernetes cluster resource configurations
against a fixed CIS-flavored check catalog, scores and persists per namespace.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/routes/postureRoutes.ts` | `GET /api/posture` — latest per-namespace snapshots |
| `backend/src/repositories/postureRepository.ts` | Appwrite snapshot persistence (collection: `posture_snapshots`) |
| `backend/src/posture/postureChecks.ts` | Pure checks: `ClusterSnapshot` → `PostureFinding[]`, severity-weighted score |
| `backend/src/workers/postureScanner.ts` | `ClusterReader` DIP seam + interval poller (default every 5 minutes) |

### Check Catalog

| Check id | Severity | Flags when |
|---|---|---|
| `privileged-pod-running` | critical | container runs `privileged: true` |
| `hostpath-mounted` | high | pod mounts a `hostPath` volume |
| `runs-as-root` | high | container does not enforce `runAsNonRoot` |
| `secret-in-env` | high | env var name matches a secret-like pattern with a literal value |
| `namespace-without-networkpolicy` | high | namespace runs pods with zero NetworkPolicies |
| `default-sa-token-automounted` | medium | default service account token is automounted |
| `latest-image-tag` | medium | image is `:latest` or untagged (not digest-pinned) |
| `no-resource-limits` | low | container lacks cpu/memory limits |

Score = `100 - Σ(severity weight)` per namespace, floored at 0
(critical 25 / high 15 / medium 8 / low 3).

### Fail-Safe Semantics

- **Read-only:** the scanner never mutates cluster state; the only route is
  `GET`.
- **Cluster read failure:** `runPostureScan` logs and returns without
  persisting — a bad tick is skipped, not a crash.
- **Snapshot persistence:** `postureRepository.saveSnapshot` logs and
  rethrows on an Appwrite write failure; `runPostureScan` catches that so a
  failed persist never crashes the interval loop — it's a lost tick, logged,
  retried on the next interval.
- **Listing snapshots:** `listSnapshots` returns `[]` with a logged warning
  if Appwrite is unreachable (fail-secure: "no data" beats crashing the UI).
- **Malformed snapshot rows:** a row with unparseable `findings` JSON is
  skipped (logged), siblings still return.
- **Immediate first tick:** `startPostureScanner` fires one scan immediately
  on boot (non-blocking) in addition to the interval — otherwise the UI would
  read empty for the first `POSTURE_SCAN_INTERVAL_MS` after every restart.
- **No cloud-API scanning:** CSPM is restricted to the Kubernetes API; cloud
  resource scanning (AWS IAM, GCP service accounts, Azure RBAC) is deferred to
  a separate, credentialed scanner.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/posture` | `{ success, data: NamespaceSnapshot[], meta: { total } }`, most-recent first |

---

## New: NetworkPolicy Zero-Trust Generator

Pure generator for deny-all + explicit allow policies (zero-trust pattern).
Policies are returned as YAML and, optionally, opened as a GitHub PR — they
are **never applied directly to the cluster**.

### Architecture

| Component | Purpose |
|---|---|
| `backend/src/routes/netpolRoutes.ts` | `POST /api/netpol/generate` |
| `backend/src/netpol/networkPolicyGenerator.ts` | Pure policy generation: namespace + flows → deny-all + DNS + per-flow allow YAML |
| `backend/src/netpol/netpolPr.ts` | GitHub App PR workflow (same bootstrap as `gitops/rollbackService`) |

### API

`POST /api/netpol/generate` (role-gated admin/security):
```json
{
  "namespace": "payments",
  "flows": [{ "from": "api-gateway", "to": "payment-service", "port": 8080 }],
  "createPr": true,
  "repo": "https://github.com/org/repo"
}
```
Response is `{ yaml }`, or `{ yaml, prUrl }` on a successful PR, or
`{ yaml, prError }` if the PR step fails — the generated artifact is still
returned even when PR creation fails.

### Generation Flow

1. Zod validates `namespace` (DNS-1123-like) and each `flow.port`
   (1–65535) at the route; `createPr: true` requires `repo`.
2. The generator re-validates the namespace against a DNS-1123 regex as
   defense-in-depth (a safety net behind the route-level check, not the
   primary boundary) and throws `400` on failure.
3. Each flow's `from`/`to` is checked against a conservative label-value
   whitelist; an invalid flow is **dropped**, not rendered — under
   default-deny its traffic simply stays denied instead of risking a
   malformed document.
4. Output: `default-deny-all` (ingress + egress) + `allow-dns` (kube-dns
   egress) + one ingress/egress policy pair per valid flow, named
   `allow-<from>-to-<to>-<port>` / `allow-egress-<from>-to-<to>-<port>`.
5. Every interpolated label value is quoted in the emitted YAML
   (`app: "web"`, not `app: web`) — an unquoted numeric-looking service name
   (e.g. `123`) would otherwise render as a YAML integer and fail cluster
   apply with a label-selector type error.

### Fail-Secure Defaults

- **Deny-all baseline:** every generated bundle defaults to deny-all, then
  whitelists explicit flows (zero-trust).
- **Invalid flows skipped:** a malformed flow does not halt generation;
  valid flows still produce policies.
- **Namespace validation:** invalid namespaces fail fast with `400`.
- **No direct cluster writes:** the generator only ever returns YAML or opens
  a PR; applying to the cluster is a separate, human-gated step.

---

## Deliberately deferred

- **Cloud-API CSPM** — Cloud Custodian/Prowler integration requires cloud
  provider credentials (AWS STS, GCP service account, Azure RBAC); deferred to
  a separate, credentialed scanning phase.
- **Service mesh installation & management** — Istio/Cilium bring their own
  deployment complexity; the NetworkPolicy generator produces manifests for
  cluster admins to apply, not an installed mesh.
- **Arbitrary Falco rule authoring** — Falco rules are SQL-like, require
  kernel probe knowledge, and are high-blast-radius; the rule catalog is a
  fixed template list, same pattern as the admission pod-security rule
  catalog. Custom rule development is a deferred, documented-separately
  workflow.
- **Direct cluster remediation outside SOAR** — pod mutations, node cordons,
  and workload migrations outside the playbook framework are out of scope;
  operator control flow through SOAR is the model.
- **Multi-cluster SOAR coordination** — response actions target the local
  cluster only; cross-cluster incident correlation is deferred.

---

## Appwrite Collections (Required at Runtime)

The scanner, SOAR orchestrator, and rule catalog depend on these collections.
Test suites fully mock Appwrite, so tests pass without them; production
requires these collections to be pre-created in the Appwrite console. Fields
marked json-string hold `JSON.stringify`'d data, parsed back on read (with a
per-row skip-and-log guard on parse failure).

| Collection | Fields |
|---|---|
| `playbooks` | `name` (string), `enabled` (bool), `trigger` (json-string), `actions` (json-string) |
| `soar_actions` | `incidentId`, `actionType`, `playbookId`, `playbookName`, `status`, `namespace`, `podName`, `ownerUserId`, `containerImage`, `falcoRule`, `createdAt`, `resolvedAt`, `resolvedBy`, `result`, `error` (all string except where noted) |
| `falco_rules` | `template` (string), `params` (json-string), `appScope` (string, nullable), `severityOverride` (string, nullable), `suppressed` (bool), `enabled` (bool) |
| `posture_snapshots` | `namespace` (string), `score` (number), `findings` (json-string), `updatedAt` (string) |
