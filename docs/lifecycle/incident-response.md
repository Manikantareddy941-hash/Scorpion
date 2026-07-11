# Incident Response — Capabilities

How Scorpion closes the DevSecOps figure-8: containment (already built in the
Operate phase), blameless post-mortem capture, forensic evidence review, and
routing lessons learned back into the Plan backlog. Industry reference points:
PagerDuty/incident.io post-mortems, Jira incident-to-ticket workflows, and
SOAR evidence capture.

## What already existed

Containment was built in the Operate phase — this phase adds the *learning*
half of incident response on top of it. See
[operate-phase.md](operate-phase.md) for full detail.

| Capability | Where | Notes |
|---|---|---|
| SOAR containment | `backend/src/soar/soarActions.ts` via playbooks (`playbookMatcher.ts`, `soarQueue.ts`) | `isolate_pod`, `kill_pod`, `capture_evidence`, `slack_escalate` — playbook-matched, tiered auto/approval, audit-logged in `soar_actions` |
| Release-gate freeze | `backend/src/services/incidentActionService.ts` (`freezeReleaseGateForIncident`) | A critical incident sets the global `pipeline_state` release node to `BLOCKED`; reversible only via the IAM-gated `gate:bypass` override |
| Incident CRUD | `backend/src/routes/incidentRoutes.ts` | Owner-scoped list / status-patch / delete |

## New: the three components

### 1. Post-mortem capture — `backend/src/services/incidentPostmortem.ts`

Pure `buildPostmortemPatch(input)` validator: `rootCause` required non-empty
string; `escapedPhase` must be one of the 8 lifecycle phases
(`plan, code, build, test, release, deploy, operate, monitor` —
`LIFECYCLE_PHASES`); `lessons` optional string (defaults `''`). Returns a
discriminated `{ ok: true, patch } | { ok: false, error }`.

Route: `PATCH /api/incidents/:id/postmortem` (`incidentRoutes.ts`) —
`404` unknown incident, `403` non-owner, `400` if the incident is not
`status: 'resolved'` (post-mortems happen *after* containment) or the body
fails validation; `200 {ok: true}` writes the patch onto the incident doc.

### 2. Incident → Plan issue — `backend/src/services/incidentFeedbackService.ts`

`convertIncidentToIssue(projectId, incidentId, userId)` returns
`'forbidden' | 'not_found' | 'not_resolved' | 'no_postmortem' | { ok, issueId }`,
mapped 1:1 to HTTP in `POST /api/incidents/:id/convert-to-issue`. Guards, in
order: project access (`assertProjectAccess`), incident ownership, resolved
status, post-mortem present (`rootCause` set). Idempotent: an incident with
`actionItemIssueId` already set returns the existing issue id instead of
creating a duplicate.

`buildIncidentIssueFields` (pure) turns the post-mortem into a Plan-phase
security story: title `[Post-mortem] <incident title>`, priority from
incident severity (`severityToPriority`), 3 story points, description with
root cause + escaped phase + lessons rendered as a `- [ ]` checklist
(`lessonsToChecklist`), labels `security`, `incident-response`,
`escaped:<phase>`. Written via `planRepository.createIssue`; the issue id is
linked back onto the incident (`actionItemIssueId`) — a failed link-back is
logged, not fatal (at-least-once).

### 3. Evidence viewer — `backend/src/repositories/soarRepository.ts`

`listEvidenceForIncident(incidentId)` queries `soar_actions` for
`actionType: 'capture_evidence'` rows (limit 25); returns `[]` on read
failure. Route: `GET /api/incidents/:id/evidence` (owner-checked, `404`/`403`
as above) maps each row to `{ actionId, playbookName, createdAt, evidence }`,
JSON-parsing `result` when possible and passing the raw string through when
not.

## Frontend

`src/components/IncidentsPanel.tsx`, mounted on `src/pages/Monitor.tsx` after
`FeedbackPanel` in the Operate section. Follows the same conventions as the
sibling `FalcoRulesPanel`/`CorrelationPanel`: `getJWT` → `Bearer` auth-fetch
helper, `premium-card` styling, `INPUT_CLS`/`LABEL_CLS` form classes,
loading/error/empty states, `react-hot-toast` on save/convert results.

- Incident list: severity badge, title, source, status, created time.
- Expanding a `resolved` incident reveals: the post-mortem form (root cause
  textarea, escaped-phase select over the 8 phases, lessons textarea,
  prefilled from existing fields, Save → PATCH); "Create Plan Issue"
  (project dropdown fed by the same `GET /api/plan/projects` endpoint
  `PlanWorkspace.tsx` uses; once `actionItemIssueId` is set, the linked issue
  id is shown instead of the button); and an Evidence accordion (lazy GET on
  first expand, pretty-printed `JSON.stringify(evidence, null, 2)` in a
  scrollable `<pre>`).
- Unresolved incidents are listed but not expandable — the post-mortem
  workflow only exists after containment.

## The figure-8 loop

```
Monitor/Operate detect → incident created → SOAR contains (isolate/kill/
capture_evidence) + gate freeze → human resolves → post-mortem (rootCause,
escapedPhase, lessons) → Create Plan Issue → security story lands in the
Plan backlog → prioritized into the next sprint → fix ships through
code/build/test/release/deploy → the class of incident stops recurring
```

The `escapedPhase` field is the pivot: it records *where in the lifecycle the
defect should have been caught*, and the generated issue carries an
`escaped:<phase>` label so the Plan board can see which phases leak.

## Runtime Prerequisites (Appwrite)

No new collections. Add four attributes to the **existing** `incidents`
collection (all optional so existing rows remain valid):

| Attribute | Type | Notes |
|---|---|---|
| `rootCause` | string | Post-mortem root cause |
| `escapedPhase` | string | One of the 8 lifecycle phases (validated server-side) |
| `lessons` | string, size 4096 | Newline-separated action items; rendered as a checklist on conversion |
| `actionItemIssueId` | string, nullable | Link to the generated Plan issue; also the idempotency marker for convert |

Test suites fully mock Appwrite, so tests pass without these attributes;
production writes will fail until they exist.

## Deliberately deferred

- **DFIR tooling** — disk/memory forensics beyond SOAR's `capture_evidence`
  snapshots (e.g. Velociraptor-style collection) is out of scope.
- **Timeline reconstruction** — an ordered event timeline stitched from
  `security_events` + `soar_actions` + status changes; the raw pieces exist,
  the stitching UI does not.
- **Auto-suggest `escapedPhase`** — the feedback-metrics scanner→phase
  mapping (`monitor-phase.md`) could pre-fill the dropdown from the
  incident's source; today the human picks.
