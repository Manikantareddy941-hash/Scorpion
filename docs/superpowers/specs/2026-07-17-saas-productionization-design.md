# Scorpion SaaS Productionization — Design

**Date:** 2026-07-17
**Status:** Approved (user, 2026-07-17)
**Goal:** Turn Scorpion from a prototype into a sellable multi-cloud DevSecOps SaaS. Success criterion: a stranger can sign up at a real URL, connect their AWS account and repos, see real security findings, gate their pipeline, and pay for a plan.

## Constraints

- **Budget:** ~$0/month infrastructure until revenue (free tiers only).
- **Timeline:** 3 months part-time. Three 4-week phases.
- **Clouds:** AWS full depth first; Azure and GCP via the same engine at launch; all three capabilities eventually (CSPM read-only, deploy targets, CI/CD ingestion).
- **Existing quality gates stay:** 80% backend statement coverage, lint 0 errors, full CI security gate.

## Current state (what we build on)

- React/Vite frontend, Express backend in clean layered architecture (routes → services → repositories), 782 backend tests, 80% coverage.
- Scan engines behind BullMQ/ioredis queues, executed via Dockerode containers: Trivy (SCA/SBOM/container), Semgrep (SAST), Gitleaks (secrets), ZAP (DAST), Checkov (IaC), Falco (runtime).
- OPA release gate, k8s ValidatingWebhook admission gate, cosign image signing, EPSS/KEV enrichment, incident response module, IaC engine (OpenTofu), Jira-equivalent plan module with automation engine.
- **Data layer is the prototype part:** Appwrite Cloud collections with a JSON-file mock fallback (`handleQuery` pattern in repositories). No Postgres.
- docker-compose + k8s manifests (kustomize overlays, ArgoCD app) exist for self-hosting.
- Auth: Appwrite Cloud (frontend `getJWT` → backend `verifyUser` middleware).

## Architecture decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Postgres (Neon free tier) replaces Appwrite collections as the system of record.** New repository implementations behind the existing repository interfaces; services and routes unchanged. | Clean architecture already isolates storage. A paid multi-tenant SaaS cannot run on a JSON-file fallback. Neon free tier = $0. |
| D2 | **Appwrite Cloud stays for auth only** (signup/login/JWT). | Already wired end-to-end; replacing auth is not on the critical path to sellable. Revisit post-launch if Appwrite limits bite. |
| D3 | **RunnerProvider abstraction** with `binary` and `docker` modes. Binary mode runs Trivy/Semgrep/Gitleaks/Checkov/Prowler as subprocesses installed in the backend image; docker mode keeps the current Dockerode path for self-hosted installs. ZAP DAST is docker-mode only (documented as a self-hosted-runner feature). | Free PaaS provides no Docker daemon. Binary mode makes scans work on Fly.io/Render; docker mode remains for the self-host story. |
| D4 | **Prowler is the CSPM engine** for AWS, Azure, and GCP. Scorpion runs it via RunnerProvider, parses its JSON/OCSF output into the existing findings pipeline (findings → EPSS/KEV enrichment → incidents → OPA gate). | One battle-tested OSS integration yields tri-cloud CSPM with CIS benchmarks, instead of hand-writing hundreds of checks per cloud. |
| D5 | **CloudConnector interface** (`verifyCredentials`, `listResources`, `runPostureScan`) with per-provider implementations. AWS v1 credential modes: access keys and cross-account IAM role with external ID (the pattern real CSPM vendors use). Azure: service principal. GCP: service-account JSON. | One interface, three providers; role-based AWS access is the industry-credible connection flow. |
| D6 | **Credentials vault:** cloud credentials and ingest tokens encrypted at rest with AES-256-GCM under a master key from the environment; decrypted only in the worker at scan time; never returned by any API. | Cloud creds are the most sensitive data the product holds. |
| D7 | **Hosting ($0):** Vercel (frontend), Fly.io or Render (API + BullMQ workers), Upstash (Redis), Neon (Postgres), Appwrite Cloud (auth). | Free tiers cover pre-revenue; cold starts acceptable. |
| D8 | **Billing via merchant-of-record** — Paddle or LemonSqueezy (global tax handled, works from India). Razorpay as fallback if domestic-first is preferred at implementation time. Plans: Free (1 repo, 1 cloud account), Pro, Team; enforced by feature-gate middleware. | Merchant-of-record removes tax/compliance burden from a solo founder. |
| D9 | **Deploy targets v1 = AWS only:** extend existing `deployService` target types (`docker`/`kubernetes`) with `ecs` — ECR image push + Fargate service update. Azure/GCP deploy targets post-launch. | Extends a proven module along its existing seam; tight scope. |
| D10 | **Cloud CI/CD ingestion = thin:** per-tenant ingest tokens on the existing generic `/api/v1/ingest/scan` endpoint + documented recipes for CodeBuild, Azure DevOps, and Cloud Build. | The endpoint already exists; the work is auth + docs, not new plumbing. |

## Phase 1 — Platform (weeks 1–4)

**1.1 Postgres data layer.** Add `pg` + a migration tool (node-pg-migrate or Drizzle). Create schema for all current collections (users' domain data, repositories, findings, scans, deployments, incidents, gate rules, pod-security config, plan_* tables, tickets). Implement Postgres-backed repositories behind the existing interfaces, replacing Appwrite/mock `handleQuery` implementations module by module. Data migration script for any existing Appwrite data. Local dev via docker-compose Postgres service. Repository unit tests run against a real Postgres in CI (service container), keeping the 80% gate.

**1.2 Hosted deployment.** Deploy per D7. Backend image bundles scanner binaries (D3). Environment/secret management per host. Health endpoints, graceful shutdown, structured logs shipped to the existing Loki setup or host-native logs. Custom domain + TLS. CI deploys on merge to main (staging) with manual promote to production.

**1.3 Tenancy + security hardening.** Audit every repository/query for tenant scoping using the existing tenancy test suites; fix gaps. Global rate limiting + per-tenant quotas. Credentials vault (D6). Complete audit logging on auth, credential, and gate-config mutations.

**Phase 1 exit:** Scorpion runs at a public URL on $0 infra, all existing features work against Postgres, scans execute in binary mode, tenancy audit clean.

## Phase 2 — Cloud connectivity (weeks 5–8)

**2.1 CloudConnector + vault flow.** Interface per D5. Connection UI: provider picker → credential form (with AWS role-assumption instructions and a generated external ID) → `verifyCredentials` round-trip → account card with connection health.

**2.2 CSPM via Prowler (D4).** New scan type `cspm` in the queue/orchestrator. Worker decrypts credentials, runs Prowler for the selected provider/regions, parses output into findings (service, resource ARN/ID, severity, CIS control mapping, remediation text). Findings flow into the existing enrichment → incidents → gate pipeline. UI: Cloud Security page — per-account posture score, findings by service and severity, CIS benchmark compliance view, re-scan scheduling (existing scheduler).

**2.3 AWS depth.** Role-assumption connection flow, region selection, service coverage validation on top-tier services (IAM, S3, EC2/VPC, RDS, Lambda, EKS/ECR, CloudTrail, KMS). Azure and GCP ship with the same Prowler engine and generic UI — connection flows tested, marketed as "beta."

**2.4 Deploy targets v1 (D9).** `ecs` target type: ECR login/push of gated images, task-definition revision, Fargate service update, rollback path mirroring the existing rollback flow.

**2.5 CI/CD ingestion (D10).** Per-tenant ingest tokens (vault-stored, revocable) + docs with copy-paste pipeline snippets for CodeBuild, Azure DevOps, Cloud Build.

**Phase 2 exit:** A tenant connects an AWS account read-only, gets CSPM findings mapped to CIS, gates a pipeline on them, and can deploy a passed image to Fargate. Azure/GCP connectable in beta.

## Phase 3 — Sell (weeks 9–12)

**3.1 Billing (D8).** Provider integration (checkout, webhooks for subscription lifecycle), plan model, feature-gate middleware (repo count, cloud-account count, scan frequency, seats). Free plan generous enough to demo the whole loop.

**3.2 Onboarding.** First-run wizard: connect repo → connect cloud → first scan, under 10 minutes. Empty states for every page. Optional demo/sample-data mode for evaluation without credentials.

**3.3 Docs + marketing.** Docs site from existing `docs/` (quickstart, connector setup per cloud, CI recipes, self-host guide). Landing page (uses existing design system; runs the anti-template checklist). Demo video/GIFs.

**3.4 Launch hardening.** Sentry (free tier) on frontend + backend, uptime monitoring, Neon PITR backups verified by a restore drill, status page, security page (data handling, credential encryption, disclosure policy), dogfood pen-test: Scorpion's own DAST/SAST/secrets/CSPM run against Scorpion's production, findings fixed.

**Phase 3 exit = launch:** public signup, working payment, docs live, monitoring on.

## Data flow (CSPM, the new path)

Tenant connects cloud account → credentials encrypted into vault → user/scheduler triggers `cspm` scan → BullMQ job → worker decrypts creds, invokes Prowler via RunnerProvider → JSON output parsed to canonical findings → stored in Postgres (tenant-scoped) → enrichment (EPSS/KEV where applicable) → incidents raised per policy → OPA gate consumes posture → UI renders account posture + compliance.

## Error handling

- Connector failures are first-class states on the account card (invalid creds, expired role, partial region failure) — never silent.
- Scan jobs: existing retry/timeout semantics; partial Prowler results stored with an explicit `partial` flag rather than dropped.
- Vault decryption failure = scan aborts with an operator-visible error; keys never logged.
- Billing webhooks idempotent; plan downgrade never deletes data, only gates features.

## Testing

- Keep 80% statement gate and lint-0-errors.
- Postgres repositories: integration tests against a CI service container.
- CloudConnector: unit tests with mocked SDK/CLI outputs; recorded Prowler fixture outputs for parser tests.
- One new E2E: signup → connect (mock cloud) → scan → findings visible.
- Billing: webhook handler tests with provider fixture events.

## Out of scope (explicitly deferred past launch)

- Azure/GCP deploy targets; deep per-cloud native checks beyond Prowler; SSO/SAML for customers (existing SSO work covers what it covers); SOC 2 certification (security page only); mobile; on-prem installer polish beyond existing docker-compose/k8s docs; ZAP DAST on hosted infra (self-hosted runner only).

## Risks

| Risk | Mitigation |
|------|------------|
| Free-tier limits (Fly/Render memory for scanner binaries) | Binary set is trimmed per host; heaviest scans (DAST) excluded from hosted mode by design (D3). |
| Prowler runtime/size on PaaS | Pin version, lazy-install layer, scan scoped to selected regions/services; fall back to top-services subset if needed. |
| Appwrite auth free-tier limits | D2 keeps it swappable; revisit post-launch. |
| Solo part-time schedule slip | Phases are independently shippable; Phase 1 alone is already "industry-ready self-host + hosted demo." |
