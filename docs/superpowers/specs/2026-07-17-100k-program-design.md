# Scorpion $100k Production-Readiness Program — Design

Date: 2026-07-17
Status: SP1 approved; SP2–7 blanket-approved (designs presented per sub-project before build; commits gated).

## Goal

Close the audited gap between "$20k code asset" and "$100k production-ready product":
adoption levers (PR feedback, EPSS/KEV), enterprise blockers (tenant isolation proof,
SSO, Postgres option, scale-out), and quality floor (E2E suite).

## Decomposition (build order)

| # | Sub-project | Why this order |
|---|-------------|----------------|
| 1 | PR-comment feedback | Biggest adoption lever; all GitHub App plumbing already exists |
| 2 | Tenant-isolation test suite | Disqualifying gap for a security product; test-only, zero product risk |
| 3 | EPSS/KEV enrichment | Modern prioritization expectation; cheap (FIRST.org API + CISA KEV feed) |
| 4 | Scale-out | node-cron→BullMQ repeatable jobs; IaC state/locks→DB. Kills single-node ceiling |
| 5 | Enterprise auth | OIDC SSO (SAML later); rides on existing requireRole RBAC |
| 6 | Postgres option | Finish Prisma migration off Appwrite coupling (dual-write already started) |
| 7 | Playwright E2E suite | Last so tests don't churn while features land |

Each sub-project: design → (plan if large) → TDD build → review → gated commit.

## SP1: PR-comment feedback — approved design

**Problem:** CI scan runs on every PR (webhook → clone → Semgrep/Trivy/Gitleaks →
policy gate → commit status) but findings never land on the PR itself. Developers
must leave GitHub to see why the gate failed.

**Approach: sticky summary comment** (Snyk/SonarCloud pattern). One comment per PR
identified by marker `<!-- scorpion-security-report -->`, updated in place on each
push. Rejected alternatives: line-level review comments (diff-position mapping
fragility, noise — future upgrade), Checks API annotations (50-annotation cap,
duplicates existing commit-status gate).

**Components:**
- `backend/src/github/prCommentService.ts`
  - `formatPrComment(scanResults, gate, dashboardUrl?)` → markdown string.
    Verdict banner, per-source severity table (Trivy SCA, Semgrep SAST, Gitleaks
    secrets), deny reasons, top-10 findings table sorted by severity, collapsible
    remainder (cap 50 rows, then "+N more"), hard cap under GitHub 64KB limit.
    Severity mapping: secrets→CRITICAL; Semgrep ERROR/WARNING/INFO→HIGH/MEDIUM/LOW.
  - `upsertPrComment(octokit, {owner, repo, prNumber, body})` — list issue
    comments, find marker, update-or-create.
- `ciOrchestrator.ts`: call after policy eval. Best-effort try/catch — comment
  failure never affects gate decision or result storage. Opt-out env:
  `SCORPION_PR_COMMENTS=false`.

**Testing:** unit tests on formatter (pass, blocked+denyReasons, empty, truncation,
marker presence) and upsert (update path, create path) with mocked Octokit.

**Error handling:** failures logged via existing logger; gate unaffected.

## SP2: Tenant-isolation test suite — built

**Problem:** tenancy machinery existed (`tenancyService`, per-route checks) but
nothing proved it end-to-end; per-route tests mock `canAccessResource` to true.

**Two layers:**
1. `src/tests/tenantIsolation.test.ts` — dynamic cross-tenant suite. Real
   tenancyService against an in-memory Appwrite fake; switchable owner/attacker
   identity. Repos, scan results, findings, incidents: attacker list → empty,
   attacker direct-ID → 403, owner positive control → 200.
2. `src/tests/tenancyCoverage.test.ts` — static ratchet. Every route file with
   direct DB access must contain a tenant-scoping marker or sit on an
   allowlist with a documented reason. New unscoped routes fail CI.

**Hole found & fixed:** docker image-scan findings were stored under pseudo-repo
`repo_id:'docker'` with no owner field — unscoped tenant data (latent leak; no
reader exposed it yet, but any future "all my findings" query would have).
Fixed by stamping `user_id` at creation (dockerScanRoutes).

## SP3–SP7

Designed per sub-project when reached; sections appended to this doc.
