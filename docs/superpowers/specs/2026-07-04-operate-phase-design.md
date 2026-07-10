# Operate Phase (Stage 7) — Design

**Date:** 2026-07-04
**Branch:** `feat/operate-phase`
**Status:** Approved

## Context

Scorpion already has the Operate-phase bones: Falco runtime event ingestion
(`falcoRoutes` → `falcoHandler`: secret-authed webhook → scan correlation →
incident → audit → Loki/metrics → Slack for Critical/Error) and a runtime
drift monitor (`driftMonitor`: polls running pods, re-validates against the
same gate rules the admission webhook uses).

Four gaps remain versus an industry Operate phase (Falco/Sysdig-class
runtime defense, Cloud-Custodian/Prowler-class posture management,
mesh-class zero trust):

1. **No response automation (SOAR).** A Critical Falco event produces only
   an incident and a Slack message. Nothing isolates or kills the
   compromised pod, and nothing captures forensic evidence.
2. **No Falco rule management.** Events arrive against invisible rules.
   No catalog, no per-app tuning, no suppression, no way to get rules
   *into* Falco.
3. **No posture management (CSPM).** The drift monitor re-checks gate
   rules only. No CIS-style configuration checks (privileged pods,
   hostPath, default SA tokens, missing NetworkPolicies…), no posture
   score.
4. **No zero-trust tooling.** Nothing generates or validates
   NetworkPolicies; lateral movement is unaddressed.

Out of scope (deliberate): running a service mesh or mTLS itself (the
mesh's job — same split as traffic shifting in the Deploy phase),
cloud-API CSPM against AWS/Azure/GCP (needs cloud credentials; the
k8s-scoped catalog covers the pattern at the seam Scorpion owns),
arbitrary Falco rule authoring (fixed template catalog, like the
admission-rule catalog), and direct cluster remediation outside SOAR
containment (GitOps stays the source of truth).

**Decided:** one spec, four thin components, single branch
`feat/operate-phase`. SOAR actions are tiered (destructive steps
approval-gated by default). Falco rules deploy as exported YAML, not
cluster pushes. CSPM is read-only; NetworkPolicy generation delivers
artifacts/PRs, never `kubectl apply`.

## Component 1: SOAR response engine

Playbook-driven response to Falco events. The only component allowed
direct cluster writes — containment cannot wait for a PR.

### Model

Playbook document (Appwrite collection `playbooks`):

```
{ name, enabled,
  trigger: { rulePattern?, minPriority },        // e.g. 'Terminal shell*', 'Critical'
  actions: [{ type, mode: 'auto' | 'approval' }] }
```

Fixed action catalog:

| Action | Effect | Destructive |
|---|---|---|
| `capture_evidence` | persist event JSON + pod spec + container statuses onto the incident | no |
| `slack_escalate` | Slack alert via existing integration lookup | no |
| `isolate_pod` | apply a single-pod deny-all NetworkPolicy (label-selected) | yes |
| `kill_pod` | delete the pod | yes |

### Execution

- Pure function `matchPlaybooks(event, playbooks)` → ordered `Action[]`.
  Zero I/O, fully unit-tested.
- `falcoHandler` calls the matcher after classification (Component 2) and
  enqueues matched actions on BullMQ `soarQueue` (dastQueue pattern:
  restart-safe, bounded retries).
- **Tiered execution:** non-destructive actions always run. Destructive
  actions run automatically only when event priority is Critical **and**
  the playbook sets `mode: 'auto'` for that action; otherwise a
  `pending_action` document is created and surfaced in the UI for
  one-click approve/reject. Fail-secure default on new playbooks:
  `approval`.
- Every executed/approved/rejected action is audit-logged and appended to
  the incident timeline.

### API

- `GET/POST/PATCH /api/soar/playbooks` — CRUD (validated, role-gated like
  `driftRoutes`: admin/security)
- `GET /api/soar/actions?status=pending` — pending approvals
- `POST /api/soar/actions/:id/approve` / `/reject` — idempotent (approving
  an already-executed action is a no-op 409, not a double execution)

## Component 2: Falco rule management

Catalog + tuning + export. Scorpion renders rules; a ConfigMap sync (or
manual copy) gets them into Falco. No cluster push.

### Model

Rule document (Appwrite collection `falco_rules`):

```
{ template,                  // id from fixed catalog
  params,                    // template-specific: allowedProcs, allowedDomains, paths
  appScope?,                 // container image prefix; empty = global
  severityOverride?,         // e.g. escalate Warning → Critical for this app
  suppressed: boolean,       // drop matching events at ingestion
  enabled }
```

Fixed template catalog (mirrors stock Falco rules):

| Template id | Detects |
|---|---|
| `terminal-shell-in-container` | interactive shell spawned in a container |
| `outbound-unknown-domain` | network connection outside `allowedDomains` |
| `write-below-etc` | write under `/etc` (params: extra watched paths) |
| `sensitive-file-read` | reads of `/etc/shadow`, ssh keys, cloud creds |
| `spawn-package-manager` | apt/yum/apk/pip executed at runtime |

### Behavior

- Pure renderer `renderFalcoRules(rules)` → `falco_rules.local.yaml`
  string. Unit-tested against expected YAML snapshots.
- `GET /api/falco/rules/export` — authed endpoint returning the rendered
  YAML (for ConfigMap sync or download).
- **Ingestion classification:** `falcoHandler` matches each incoming event
  against the catalog by rule name + container image. Suppressed →
  audit-log and drop (no incident, no playbook). `severityOverride`
  applied before incident creation and playbook matching. Unknown rules
  pass through unchanged (never drop what we don't recognize).

## Component 3: CSPM posture checks (Prowler-lite, k8s-scoped)

Read-only CIS-flavored configuration checks against the live cluster,
using the same k8s client seam as `driftMonitor` (`PodLister`-style DIP
interface, pure check functions).

### Check catalog (fixed)

| Check id | Flags when |
|---|---|
| `privileged-pod-running` | running container with `privileged: true` |
| `hostpath-mounted` | pod mounts a `hostPath` volume |
| `default-sa-token-automounted` | pod uses default SA with token automount |
| `no-resource-limits` | container lacks cpu/memory limits |
| `latest-image-tag` | running image pinned to `:latest` or untagged |
| `runs-as-root` | container without `runAsNonRoot` |
| `namespace-without-networkpolicy` | namespace has pods but zero NetworkPolicies |
| `secret-in-env` | env var name matching secret patterns with literal value |

### Behavior

- Each check is a pure function over pod/namespace/NetworkPolicy listings
  → `PostureFinding[]` (severity, resource, reason). Fully unit-tested.
- Poller worker (driftMonitor pattern: interval env-configurable,
  Redis-deduped) runs the catalog, persists findings and a per-namespace
  posture score (weighted by severity) to Appwrite.
- `GET /api/posture` — namespaces with scores + findings (role-gated
  admin/security). No auto-remediation.

## Component 4: Zero-trust NetworkPolicy generator

Pure generator; delivery via download or auto-PR through the existing
GitOps PR mechanics (same seam as rollback PRs). Never applies to the
cluster.

- Input: namespace + declared flows `[{ from: svcA, to: svcB, port }]`.
- Output YAML: default-deny-all (ingress+egress) + DNS-allow egress +
  one explicit allow policy per declared flow (label-selector based).
- `POST /api/netpol/generate` — returns YAML; optional `createPr: true`
  opens a GitOps PR with the manifests.
- The `namespace-without-networkpolicy` posture finding links here in
  the UI.

## UI

Operate section, four panels following `CanaryPanel`/
`PodSecurityRulesPanel` conventions:

1. **SOAR:** playbook list + editor (trigger, action list with auto/
   approval toggles), pending-approval queue with approve/reject,
   incident action timeline.
2. **Falco rules:** catalog list, per-rule params/scope/severity/
   suppression editing, export button.
3. **Posture:** per-namespace score cards, findings table
   (severity-sorted), NetworkPolicy deep-link.
4. **NetworkPolicy generator:** namespace + flow rows, generated YAML
   preview, download / create-PR buttons.

## Error handling

- Workers: k8s/Appwrite/Slack errors are bounded retries then failed
  jobs — never unhandled rejections. A failed destructive action marks
  the action `failed` and escalates the incident (fail-loud).
- Ingestion: malformed Falco events are audit-logged and ignored, not
  crashes; classification errors fail open to the existing incident path
  (never silently drop a threat because config load failed).
- Approvals: idempotent; double-approve cannot double-execute.
- Routes: zod validation at entry, 4xx with clear messages, role-gated
  per the `driftRoutes` precedent.

## Testing

- Unit: `matchPlaybooks` (pattern/priority matching, tier logic),
  `renderFalcoRules` (each template, params, suppression excluded),
  every posture check (positive/negative/malformed spec), NetworkPolicy
  generator (deny-all + flows + DNS).
- Routes: soar/posture/netpol route tests following sibling `*.test.ts`
  patterns; falcoRoutes tests extended for classification (suppress,
  override, unknown-rule passthrough).
- Per chunk: `tsc --noEmit`, lint, full backend suite green.

## Build order

1. `matchPlaybooks` + tier logic + tests (pure)
2. soarQueue/worker + pending-action approval flow + routes + tests
3. Falco rule catalog + `renderFalcoRules` + export route + ingestion
   classification in `falcoHandler` + tests
4. Posture check functions + tests (pure), then poller worker + routes
5. NetworkPolicy generator + tests, route + GitOps PR wiring
6. UI panels (SOAR, Falco rules, Posture, NetPol generator)
7. Docs: `docs/lifecycle/operate-phase.md`
