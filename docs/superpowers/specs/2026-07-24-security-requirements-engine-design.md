# Security Requirements Engine (Plan-phase feature 2a) — Design

Date: 2026-07-24
Status: Approved for planning
Owner: Plan & Design lifecycle stage

## Problem

Scorpion already has most of the Plan-phase threat-modeling stack: diagram-based
STRIDE modeling (`threatModelService`, `threatAiService`), per-threat
countermeasures, bi-directional Jira sync (`jiraService`), and a runtime
compliance evaluator (`complianceEngine`). What it lacks is the *foundational*
Plan-phase capability: an engine that turns a project's profile into concrete,
traceable **security requirements** before any code is written — the SD-Elements
equivalent, and the "brain" the later features (2b compliance→threat mapping,
3a threat→sprint-ticket bridge) will consume.

Today there is nothing: a grep for `securityRequirement`, `generateRequirements`,
`codingStandard`, `SD Elements` returns zero files. Teams therefore rely on
manual interpretation of compliance obligations, which produces exceptions and
weak auditability — exactly the failure mode DevSecOps planning is meant to
remove.

## Goals

- Given a project profile, deterministically generate a set of security
  requirements, each traceable to a specific control (e.g. PCI DSS 6.5.1).
- Persist generated requirements with a lifecycle (open / satisfied / waived)
  and an audit trail (who, when, justification).
- Regeneration is safe: re-running after a profile change preserves the
  lifecycle status of still-applicable requirements and never silently drops
  history.
- Prove accuracy by execution: deterministic engine → table-driven unit tests
  asserting exact output; persistence proven against Appwrite, not the JSON
  fallback.

## Non-goals (YAGNI / deferred)

- **No AI generation.** Chosen explicitly: rule-based is deterministic,
  testable, and defensible; SD Elements itself is a curated content library.
- **No rule-editing UI / DB-stored rules.** Rules are code, versioned and
  PR-reviewed. Admin editing is a later concern if ever needed.
- **2b (dynamic recommended→required flip driven by a chosen framework on a
  threat model)** is a later cycle. 2a only sets each requirement's
  `defaultStatus` from its own rule.
- **3a (threat/requirement → sprint ticket bridge)** is a later cycle. 2a
  produces the actionable items; the bridge that pushes them to Jira comes next.
- **Frontend polish.** A functional per-project Requirements page ships with
  2a; visual refinement is later.

## Architecture

Rule-based, deterministic, layered per `backend/CLAUDE.md` (transport →
application → infrastructure).

### 1. Rule library — `backend/src/services/securityRequirementRules.ts`

A curated array of rules. Each rule is:

```ts
interface RequirementRule {
  id: string;                 // stable rule id, e.g. 'pci-sql-injection'
  when: (p: ProjectProfile) => boolean;   // predicate over the profile
  emit: Omit<GeneratedRequirement,
    'projectId' | 'lifecycleStatus' | 'justification' | 'createdAt'>[];
}
```

Each emitted requirement carries: `code` (stable, e.g. `REQ-PCI-6.5.1-SQLI`),
`title`, `description`, `category`, `framework`, `controlId`, `severity`,
`status` (required | recommended — the rule's default), `remediation`,
`sourceRuleId`.

Seed a **starter library of ~25–30 real requirements** spanning the 6 profile
dimensions and 6 frameworks (PCI DSS, NIST 800-53, SOC 2, ISO 27001, HIPAA,
GDPR). Not exhaustive; explicitly extensible. Accuracy over breadth: every
seeded requirement must cite a genuine control.

### 2. Engine — `backend/src/services/securityRequirementsEngine.ts`

```ts
export function generate(profile: ProjectProfile): GeneratedRequirement[]
```

Pure function, no I/O. Iterates the rule library, runs each `when(profile)`,
flattens the `emit` of matching rules, then **de-duplicates by `code` with
multi-framework merging**, and returns a stable-ordered list. Because it is pure
and deterministic, the same profile always yields the same set — the basis for
the unit tests.

**Multi-framework merging (audit-critical).** A single control belongs to one
rule, so each rule emits its own `framework` + `controlId` (singular). But the
same baseline requirement (e.g. `REQ-AUTH-MFA`) is legitimately emitted by
multiple rules — a PCI rule and a SOC 2 rule. On a `code` collision the engine
must **merge, never overwrite**: the surviving `GeneratedRequirement` carries
`frameworks: string[]` and `controlIds: string[]` (deduped, stable-ordered),
plus the union of `sourceRuleId`s. Overwriting would drop a framework's
metadata, so an auditor reviewing SOC 2 would miss that the requirement was
already satisfied under a PCI tag. `severity` on collision takes the highest;
`status` takes the strongest (`required` beats `recommended`).

The rule's `emit` therefore uses singular `framework`/`controlId`; the merged
`GeneratedRequirement` (and the stored row) uses the plural `frameworks`/
`controlIds` arrays.

### 3. Reconciliation — part of the engine service

```ts
export function reconcile(
  generated: GeneratedRequirement[],
  stored: StoredRequirement[],
): { toCreate: ...; toUpdate: ...; toObsolete: ... }
```

`code` is stable per requirement, so reconciliation keys on it:
- present in both → keep the stored row and its lifecycleStatus/justification,
  update only the descriptive fields if the rule text changed.
- new in generated → create (lifecycleStatus `open`).
- in stored but no longer generated → mark `lifecycleStatus: 'obsolete'`
  (never delete — audit).

This is the same "incoming batch reconciled against current state" shape as scan
delta ingestion, but scoped to one project's requirements and non-destructive.

### 4. Storage — two new Plan collections (same pattern as the Plan Workspace)

`plan_project_profiles` (one per project):

| attr | type | notes |
|---|---|---|
| projectId | string 64 | required; one profile per project |
| appType | string 32 | web \| api \| mobile \| service |
| stack | string[] | node, python, java, go, ... |
| dataTypes | string[] | card, health, pii, none |
| deployment | string 32 | cloud \| on-prem \| hybrid |
| authModel | string 32 | none \| session \| oauth \| mtls |
| frameworks | string[] | PCI, NIST, SOC2, ISO27001, HIPAA, GDPR |
| updatedAt | string 64 | required |

`plan_security_requirements`:

| attr | type | notes |
|---|---|---|
| projectId | string 64 | required; index |
| code | string 128 | required; stable requirement code |
| title | string 512 | required |
| description | string 16384 | off-row TEXT |
| category | string 64 | |
| frameworks | string[] | required; merged across rules that emit this code |
| controlIds | string[] | e.g. ['PCI 6.5.1', 'CC6.1']; merged, parallel to frameworks |
| severity | string 16 | low \| medium \| high \| critical (highest on merge) |
| status | string 16 | required \| recommended (strongest on merge) |
| lifecycleStatus | string 16 | open \| satisfied \| waived \| obsolete |
| justification | string 4096 | for satisfied/waived (audit) |
| updatedBy | string 64 | user id/email that set the current lifecycleStatus (audit identity) |
| sourceRuleId | string[] | traceability; union of rules that produced this code |
| createdAt | string 64 | required |

Indexes: `projectId_idx` on both; `projectId_idx` + a `code` lookup path on
requirements. Permissions empty (backend API key), following the Plan
collections. Attribute sizing follows the lessons from #125: strings ≥16384 go
off-row to avoid the ~64KB row overflow; poll attribute availability before
building indexes.

### 5. Repository — `backend/src/repositories/securityRequirementsRepository.ts`

Follows `planRepository`: Appwrite primary with a JSON fallback, tenant-scoped
by the owning project (`plan_projects.user_id`). Methods: `getProfile`,
`upsertProfile`, `listRequirements`, `bulkApplyReconcile`, `updateRequirement`.
`updateRequirement(reqId, { lifecycleStatus, justification, updatedBy })`
persists the audit identity alongside the status change — `updatedBy` is never
taken from the request body, only from the authenticated session.

> Note the standing `handleQuery` silent-fallback caveat: the fallback must not
> mask a real Appwrite error in production. Requirements persistence is proven
> against Appwrite in the round-trip test, not asserted.

### 6. Routes — `backend/src/routes/securityRequirementsRoutes.ts`

Mounted under the existing plan surface. All Zod-validated at the boundary,
tenant-checked via project ownership, 404-not-403 for inaccessible projects.

- `PUT  /api/plan/projects/:projectId/profile` — upsert profile.
- `POST /api/plan/projects/:projectId/requirements/generate` — run engine +
  reconcile + persist; returns the current requirement set.
- `GET  /api/plan/projects/:projectId/requirements` — list.
- `PATCH /api/plan/requirements/:reqId` — set `lifecycleStatus`
  (satisfied/waived) + `justification`. The route extracts the actor's identity
  from the auth middleware (`req.user`) and passes it as `updatedBy` to the
  repository — the client cannot spoof it via the body. Writes an audit event.

### 7. Frontend — per-project Requirements page

Profile form (the 6 dimensions) → "Generate" → requirement list grouped by
framework, each showing control id, severity, required/recommended, and a
satisfied/waived action with a justification field. Functional first; reuses the
existing Plan Workspace UI patterns.

## Data flow

```text
profile form ──PUT──> upsertProfile ──> plan_project_profiles
                                   │
        POST generate ────────────┘
             │
   engine.generate(profile) ──> requirements[]
             │
   reconcile(generated, stored) ──> create / keep-status / obsolete
             │
   persist ──> plan_security_requirements
             │
        GET list ──> Requirements page
             │
   PATCH satisfied/waived + justification ──> audit trail
```

## Error handling

- Route boundary: Zod schemas validate profile and PATCH payloads; reject
  unknown enums (appType, deployment, authModel, framework) with 400.
- Engine: pure, cannot throw on I/O; a malformed rule is caught by the
  rule-library integrity test at CI time, not at runtime.
- Repository: explicit try/catch; tenant check returns 404 for non-owned
  projects; never leak another tenant's requirements.

## Testing (the accuracy proof)

1. **Engine unit tests (table-driven):** for representative profiles, assert the
   *exact* generated requirement codes. Deterministic ⇒ exact assertions.
   - e.g. `{ dataTypes: ['card'], frameworks: ['PCI'] }` ⇒ includes
     `REQ-PCI-6.5.1-SQLI`, `REQ-PCI-3.4-ENCRYPT-AT-REST`; excludes HIPAA reqs.
2. **Multi-framework merge test:** a profile whose frameworks include both PCI
   and SOC 2, where both emit `REQ-AUTH-MFA`, yields a single requirement with
   `frameworks: ['PCI DSS', 'SOC 2']` and both control ids — never one
   overwriting the other; severity is the highest and status the strongest of
   the two.
3. **Rule-library integrity test:** every emitted requirement has a non-empty
   `code`, a known `framework`, a valid `severity` and `status`, a `controlId`,
   and a unique `code` per `(rule, code)`; no two rules disagree on a code's
   category.
4. **Reconciliation test:** regenerate after marking a requirement `satisfied`
   preserves that status *and* its `updatedBy`; a requirement that drops out
   becomes `obsolete`, not deleted.
5. **Repository round-trip** (`e2e_plan_roundtrip`-style, dotenv-first): upsert
   profile → generate → read every requirement back via `getDocument`,
   asserting Appwrite persistence (not JSON fallback). Confirms schema accepts
   the payloads incl. array attributes (write-probe, not list-probe — the
   phantom-attribute lesson).
6. **Route tests** (supertest): auth/tenancy (404 on non-owned project),
   validation (400 on bad enum), happy path, and that `updatedBy` is written
   from the session — never from the body.
7. Coverage target 80% per repo standard.

## Migration & tooling

- A dedicated idempotent `migrate_security_requirements_collections.ts` (its own
  file, not folded into the plan migration — separate concern, separate review)
  creating the two collections with the row-size-safe sizing and availability
  polling already proven in #125. Includes the `frameworks`, `controlIds`, and
  `sourceRuleId` string-array attributes, the `updatedBy` audit attribute
  (string 64), and off-row `description` (≥16384).
- Reuse `check_plan_collections.cjs`'s verification shape and the
  round-trip write-probe to confirm the schema end-to-end before wiring the UI.

## How 2b and 3a build on this

- **2b** adds framework selection on a *threat model* and flips a matched
  requirement/countermeasure's `status` from recommended → required; it reads
  this engine's requirement set and control mappings.
- **3a** adds `createFromRequirement` (mirroring `ticketsService.createFromFinding`)
  to push a requirement into a sprint as a ticket, then through the existing
  `jiraService` sync.

Both are separate cycles; 2a ships standalone and verifiable.

## Build order (for the implementation plan)

1. Types + rule library (starter set) + engine + reconcile — pure, fully unit
   tested first (TDD).
2. Collections migration + check + round-trip write-probe.
3. Repository (Appwrite + fallback, tenant-scoped).
4. Routes + route tests.
5. Frontend Requirements page.
6. Verify end-to-end, commit per chunk, push, merge if green.
