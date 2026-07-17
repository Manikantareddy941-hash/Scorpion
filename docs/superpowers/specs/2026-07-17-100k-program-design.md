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

## SP3: EPSS/KEV enrichment — built

**Problem:** prioritization was raw CVSS severity; buyers expect
exploit-likelihood ranking (EPSS) and known-exploited flags (CISA KEV).

**Approach:** enrich at ingestion (new/modified findings only), best-effort.
- `enrichmentService.ts` — EPSS batch fetch (FIRST.org, 100/req, 8s timeout),
  KEV catalog with 24h in-memory cache + stale-on-failure, and
  `computeRiskScore`: severity base (50/35/20/10) + EPSS×40 + KEV +25, cap 100.
  A KEV'd or high-EPSS medium deliberately outranks a plain high.
- `scanService.ingestScanDeltas` — enriches before insert; if the collection
  predates the migration, retries the write without enrichment fields so no
  finding is ever dropped.
- `scripts/migrate_enrichment.ts` — adds epss_score, epss_percentile, kev,
  risk_score attributes (idempotent).

Feed outages degrade to severity-only scoring, never block ingestion.
Deferred: dashboard sort-by-risk_score UI, nightly re-score backfill.

## SP4: Scale-out — built

**Problem:** in-process node-cron schedulers fire once *per replica* (2 replicas
= duplicate scans/reports); IaC workspace lock was in-process only.

- Scan schedules: node-cron per-repo tasks → **BullMQ job schedulers** on the
  existing scan queue (Redis-backed, exactly-once across replicas). The 1-min
  reconcile tick remains but is idempotent (upsert/remove), safe on every
  replica. Worker contract unchanged.
- AI report schedules: same pattern; report execution extracted to
  `runScheduledReport(scheduleId)` (re-reads config fresh, honors
  deactivation), runs on new `report-dispatch` queue + worker.
- IaC workspace lock: in-process Set → **Redis lease lock**
  (`utils/redisLock.ts`, SET NX PX + Lua compare-and-del, 30-min lease,
  in-process fallback when Redis unavailable in dev).

**Deferred (documented constraint):** IaC workspace/run store and tfstate stay
on the filesystem — run the backend with a single replica handling IaC, or
mount `DATA_DIR` on a shared RWX volume. Migrating live tfstate to a remote
backend is the correct long-term fix and its own project.

## SP5: Enterprise auth (OIDC SSO) — built

**Approach: Appwrite custom-token bridge.** Backend runs the standard OIDC
code+PKCE flow (openid-client v6: discovery, state+nonce in httpOnly lax
cookies), extracts the verified email claim, JIT-provisions the Appwrite user
on first login, then mints an Appwrite custom token. The frontend exchanges it
on the existing /auth/callback page via account.createSession — verifyUser and
the whole session stack stay untouched. Works with any spec-compliant IdP
(Okta, Auth0, Entra ID, Keycloak).

- `services/oidcService.ts` + `routes/ssoRoutes.ts` (GET /auth/sso/login,
  GET /auth/sso/callback), mounted behind the auth rate limiter
- Config-gated: OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET
  (see .env.example); unset → 503. Frontend button behind VITE_SSO_ENABLED.
- Rejected: passport (session middleware baggage), custom JWTs (would fork the
  auth model), Appwrite built-in providers only (no generic-IdP guarantee).

Deferred: SCIM provisioning, IdP group→role mapping, SAML.

## SP6: Postgres option via Prisma — built

**Honest scope:** the primary datastore is Appwrite; Prisma backs only the
durable scan-audit store (one model, `ScanResult`). Full Appwrite→Postgres
migration is a separate multi-month project. This sub-project makes the
existing Prisma layer run on Postgres as a first-class alternative to SQLite —
the concrete answer to a buyer's "can we run it on our own Postgres?".

- `prismaAdapter.ts` — `createAdapter(url)` picks the driver from the
  DATABASE_URL scheme (file: → better-sqlite3, postgres:// → pg), throws on
  unknown schemes. `prismaClient.ts` now delegates to it.
- `prisma/schema.postgres.prisma` — Postgres provider variant (identical
  model); `npm run prisma:generate:pg` regenerates the client for it.
- Switching a deployment to Postgres = generate:pg + point DATABASE_URL at it;
  no application code change.

Deferred: migrating the Appwrite-backed collections themselves to Postgres.

## SP7: Playwright E2E suite — built

**Scope:** smoke coverage of the unauthenticated surface — the "one refactor
away from silent UI breakage" gap the audit named (frontend had 19 tests, no
E2E). Authenticated flows need a live backend + Appwrite + Redis and are
deferred to a CI environment that provisions them.

- `playwright.config.ts` — chromium project, auto-starts `vite preview`
  (HTTPS via basic-ssl, self-signed cert ignored), `npm run test:e2e`.
- `e2e/auth.smoke.spec.ts` — 7 tests, all green against a real browser:
  login page renders (heading + Vector ID field + Login button), empty-submit
  stays on /login, four protected routes (/,  /settings, /reports, /repos)
  redirect to /login, SSO entry point present iff VITE_SSO_ENABLED.

Verified by execution: `npm run build && npx playwright test` → 7 passed.
Deferred: authenticated journeys, visual regression, cross-browser.

## Status

SP1–SP7 all built, tested, committed on branch feat/pr-comments. Backend suite
558 tests green; E2E 7 green.
