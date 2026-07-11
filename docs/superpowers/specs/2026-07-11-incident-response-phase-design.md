# Incident Response & Feedback Loop — Design

Date: 2026-07-11
Branch: `feat/incident-response-phase` (off `feat/monitor-phase`)
Status: Approved

## Goal

Close the DevSecOps figure-8: when an incident is contained, capture a blameless
post-mortem (root cause, which lifecycle phase the flaw escaped, lessons), route
those lessons back to the Plan phase as a backlog issue, and surface the
forensic evidence SOAR already captured. Three thin components — no new
collections, no new infra.

## What already exists (not rebuilt)

- **SOAR containment** (Operate) — playbooks, tiered approval, `isolate_pod`
  (quarantine label + deny-all NetPol: the "isolate, don't delete" forensics
  move), `kill_pod`, `capture_evidence` (pod spec + Falco event JSON, stored on
  the `soar_actions` record), `slack_escalate`.
- **Auto-containment** — critical incident → platform-wide release-gate freeze
  with IAM break-glass override (`incidentActionService.freezeReleaseGateForIncident`).
- **Feedback metrics** (Monitor) — MTTR / reopen-rate / escape-by-phase.
- **Threat→backlog** (Plan) — `planService.convertThreatToIssue` (idempotent,
  Prisma plan issues); the pattern component B mirrors.
- **Incident workflow** — `incidents` collection, open/investigating/resolved +
  assignee + resolvedAt; `GET /api/incidents` owner-scoped by `user_id`.
- **Fact:** incidents currently have NO frontend — Slack + API only. The
  IncidentsPanel below is their first UI surface.

## A. Post-mortem / RCA

- **Storage:** 4 new attributes on the existing `incidents` collection —
  `rootCause` (string), `escapedPhase` (string), `lessons` (string),
  `actionItemIssueId` (string, nullable). One post-mortem per incident is 1:1;
  a separate collection is YAGNI.
- **Pure helper** `buildPostmortemPatch({rootCause, escapedPhase, lessons})` —
  requires non-empty `rootCause` AND `escapedPhase` ∈ {plan, code, build,
  test, release, deploy, operate, monitor} (both mandatory — the convert
  labels depend on the phase); `lessons` optional; returns the patch object
  or a validation error. Unit-tested.
- **Route** `PATCH /api/incidents/:id/postmortem` — only on incidents with
  `status === 'resolved'` (400 otherwise: post-mortem happens after
  containment); owner-scoped exactly like the existing incident routes
  (`user_id === caller`); 404 unknown incident, 403 not owner.

## B. Incident → Plan routing (the loop restart)

- **Pure helper** `buildIncidentIssueFields(incident, projectId)` — mirrors
  `buildThreatIssueFields`: type `story`, title `[Post-mortem] <incident
  title>`, description composed from rootCause + lessons, labels
  `[security, incident-response, escaped:<phase>]`, acceptance criteria = one
  checklist line per non-empty `lessons` line. Unit-tested.
- **Service** `convertIncidentToIssue(projectId, incidentId, userId)` in
  planService — mirrors `convertThreatToIssue`: `assertProjectAccess` →
  'forbidden'; incident must exist, be owner's, be resolved, and have a
  `rootCause` (400-equivalent 'no_postmortem' — nothing to route otherwise);
  **idempotent**: `actionItemIssueId` already set → return existing;
  `planRepository.createIssue(...)` then write `actionItemIssueId` back onto
  the incident (Appwrite). Cross-store bridge: Appwrite incident → Prisma
  plan issue, same direction the threats bridge already goes.
- **Route** `POST /api/incidents/:id/convert-to-issue` — body `{projectId}`
  (user picks the Plan project in the UI, same as the threats tab).

## C. Evidence viewer

- **Route** `GET /api/incidents/:id/evidence` — owner-scoped incident check,
  then `soar_actions` rows where `incidentId === :id` and
  `actionType === 'capture_evidence'`; returns
  `[{actionId, playbookName, createdAt, evidence}]` with `evidence` =
  parsed `result` JSON (tolerant parse — raw string if malformed). Read-only.

## Frontend — IncidentsPanel (first incident UI)

New `src/components/IncidentsPanel.tsx` on `Monitor.tsx` after FeedbackPanel,
matching the existing panel design system (auth-fetch, loading/error/empty
states, severity pills):
- Incident list (`GET /api/incidents`): title, severity, source, status, time.
- Expanded resolved incident → post-mortem form (rootCause textarea, escapedPhase
  select, lessons textarea → PATCH), "Create Plan Issue" (project dropdown fed by
  the existing plan projects endpoint → POST convert; shows linked issue id when
  `actionItemIssueId` set), evidence accordion (GET evidence, pretty-printed JSON).

## Security / tenancy invariants

- Every new route `verifyUser` + incident ownership check (`user_id === caller`)
  before any read/write — same rule the existing incident PATCH uses.
- Convert additionally requires plan-project access (`assertProjectAccess`).
- Evidence is returned only for the owner's incidents; no cross-tenant reads.
- All mutations audited via the existing route logging conventions.

## Runtime prerequisites (user action)

Add 4 attributes to the existing `incidents` collection: `rootCause` (string),
`escapedPhase` (string), `lessons` (string, size generous e.g. 4096),
`actionItemIssueId` (string, nullable). No new collections.

## Deferred (with reasons)

- DFIR tooling (OSQuery/Velociraptor/Wazuh) — infrastructure agents, not app code.
- Cortex XSOAR / Tines / cloud SOAR — buy-vs-build, same call as Splunk/Sentinel.
- Incident timeline reconstruction, multi-author post-mortems — YAGNI.
- Auto-suggesting `escapedPhase` from finding scanner data — nice-to-have after
  post-mortems accumulate.

## Verification

Pure helpers unit-tested (validation enum, issue-field building, idempotency);
route tests mocked per existing `*.test.ts` patterns (ownership 403, resolved-only
400, no-postmortem 400, idempotent convert); `tsc --noEmit` + lint clean; full
backend suite green; frontend tsc clean.
