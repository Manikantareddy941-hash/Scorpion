# Unified DevSecOps Platform — Core Architecture

Date: 2026-07-18
Status: governing architecture. Supersedes ad-hoc structure decisions; subordinate to
`2026-07-17-saas-productionization-design.md` for phasing.

Goal: one engine covering CI/CD orchestration, vulnerability scanning, IaC security
and automated remediation — replacing the context-switching between four tools.

---

## 0. Two corrections to the premise, stated first

An architecture built on a wrong premise fails expensively, so these come before
the requirements.

**Scorpion does not replace the scanners. It replaces the toolchain.** Trivy,
Semgrep, Gitleaks, Checkov, ZAP and Falco are commodity engines — free, well
maintained, and each better at its niche than anything this project could rebuild.
Competing with them means losing slowly. What is genuinely fragmented is
everything *around* them: six output formats, six severity scales, no shared
identity for "the same vulnerability", no common policy language, no path from a
finding to a fix. **The product is the layer between the scanners, not the
scanners.** Every requirement below follows from that.

**"Autonomous" must mean reversible, not unattended.** A security tool that
auto-remediates and breaks production destroys trust faster than one that misses
a CVE — the first is your fault, the second is the industry's. Autonomy is earned
per action class, and every automated action needs a preview, a blast radius, and
an undo. This is a design constraint, not a maturity phase.

---

## 1. One execution abstraction

**Requirement:** every external tool invocation goes through a single provider
interface. No call site spawns a process or a container directly.

Status: **built** (`services/runner/`, PR #89). `RunnerProvider` with docker and
binary strategies, capability declared per tool via `supports()`.

Why it is load-bearing: before it, three independent execution paths existed
(`spawn('docker')` in the orchestrator, dockerode in `dockerRunnerService`, bare
`spawn` elsewhere). Three paths mean three places to fix a sandbox escape and
three different failure semantics. It also made the platform undeployable —
every path assumed a Docker daemon.

Outstanding: `containerizedTrivyService`, `iacService` and `pipelineService` still
call `dockerRunnerService` directly. Migrating them is mechanical.

**Invariant: a tool that cannot run reports `unavailable`, never a clean result.**
This is the single most important rule in the system. A scanner that crashed and
reported "0 findings" tells a user their code is safe when nothing looked at it.
That bug existed and was fixed in PR #89; the invariant exists so it cannot return.

## 2. One storage authority

**Requirement:** exactly one system of record per class of data, with one schema
authority.

Status: **violated, and this is the largest architectural debt.** Live today:
Postgres (11 repositories), Appwrite (6 repositories + identity), Prisma/SQLite
(scan audit), Redis (admission hot path), JSON files (drift fallback), and
in-process Maps (previously ticket comments — fixed in PR #91).

The cost is not aesthetic. Every boundary between stores is a place where
transactions do not compose, where migrations diverge, and where a value can be
authoritative in two places at once. Concretely this year: `DATABASE_URL` meant
two different things to two layers, so the scan-audit table was never created on
Postgres (PR #90); `deleteTicket` cleared two in-memory maps and forgot a third,
leaving dangling links (PR #91).

Target end state:
- **Postgres** — system of record for all domain data, schema owned solely by `node-pg-migrate`.
- **Redis** — cache and queue only. Nothing may exist *only* in Redis.
- **Appwrite** — identity provider only (decision D2). No domain data.
- **Prisma** — retire. One model does not justify a second ORM, migration tool and generated client.

Rule: **if losing Redis loses data, the design is wrong.**

## 3. Tenant identity as a structural primitive

**Requirement:** every row carries an owner; every read is scoped at the data
layer; no endpoint can opt out.

Status: **partially built, and the pattern is currently bolted on per resource.**
The primitives are good (`tenancyService`: `resolveOwnershipScope`,
`canAccessResource`, `resolveCreationOwnership`). Adoption is inconsistent —
tickets had no owner at all until PR #93.

This inconsistency is structural, not accidental. When tenancy is enforced by
each route remembering to call a helper, the failure mode is silent: the route
that forgets returns data instead of an error. Two rules follow:

- **Enforce in middleware or the repository, never per handler.** PR #93 applies the ticket guard once as router middleware for exactly this reason.
- **Deny by default.** A row with no owner must be unreachable, not world-readable. Ownerless legacy tickets are invisible; that is correct.
- **Never accept an owner from the request body.** It comes from the authenticated session. A body-supplied `user_id` lets a caller create resources owned by someone else.
- **Return 404, not 403,** for a resource the caller cannot see. 403 confirms the id exists and turns the endpoint into an id oracle.

**Open HIGH finding blocking multi-tenancy:** the CI ingest key is a single global
env var, and the admission cache is keyed `scan:<digest>` with no tenant
component. Any key holder — every customer, in a multi-tenant deployment — can
declare any image digest clean and another tenant's pod is admitted. This is a
gate bypass, not a disclosure. Fix is per-tenant ingest tokens, then
`scan:<tenant>:<digest>`. **Do not onboard a second customer until this lands.**

## 4. A normalized finding model — the actual product

**Requirement:** all scanners converge on one `Finding` schema with a stable
identity, before anything downstream sees them.

This is the consolidation the platform sells. Six tools emit six shapes with
incompatible severity scales; a user reconciling them by hand is the tool sprawl
being eliminated. The unification must happen once, at ingest.

Required properties:
- **Stable dedup identity.** A fingerprint over (rule, artifact, location, package) — never the scanner's own id, which changes between versions. Without this, the same vulnerability from two scanners is two findings and every count is wrong.
- **One severity scale**, with each tool's native value retained for provenance.
- **Lifecycle independent of scans.** A finding is open/triaged/suppressed/fixed and survives re-scans; it does not get recreated each run.
- **Provenance on every finding:** which tool, which version, which run. Pinned scanner versions (PR #92) exist so a finding is attributable — an unpinned scanner changes results between builds and no regression can be traced.

Status: partially present (`deduplication/`, `services/scan/parsers`). Not yet a
single enforced schema all paths share.

## 5. One policy engine, many enforcement points

**Requirement:** gates, admission control, suppressions and drift all evaluate the
same policy objects through one evaluator.

The same question — "does this violate policy?" — is currently asked at the CI
gate, the Kubernetes admission webhook, the drift monitor and the suppression
matcher. If those diverge, the platform blocks a deploy in CI and admits it at the
cluster, which is worse than having no gate: it is a gate that lies.

One evaluator, many call sites. Policy objects are data, versioned and auditable.

## 6. An event spine, not a call graph

**Requirement:** the pipeline scan → finding → correlation → ticket → remediation
is connected by events, not direct service calls.

Direct calls make the platform a monolith of mutual imports where a slow Jira sync
blocks a scan, and where adding a consumer means editing the producer. This is the
difference between a bundle of tools in one repo and a cohesive engine.

Consequences to design for: every consumer must be idempotent (events are
delivered at least once), and every event carries its tenant.

Status: BullMQ exists for scan jobs. The remaining hops are direct calls.

## 7. Remediation with provenance and an undo

**Requirement:** every automated action records who/what/why, and is reversible or
explicitly marked irreversible before it runs.

Action classes, in increasing danger: comment a PR → open a ticket → propose a
patch → merge a patch → isolate a pod → block a deploy. Autonomy is granted per
class per tenant, not globally.

Non-negotiable for the top three: dry-run preview, blast radius stated up front,
audit record written *before* the action, and a documented rollback. SOAR
playbooks already model approve/auto modes — that mechanism generalises.

## 8. Integrations are adapters, not replacements

**Requirement:** one interface per external system category, several
implementations.

Eliminating tool sprawl does not mean customers abandon GitHub, Jira, Kubernetes
or AWS. It means they stop context-switching between *security* tools. A platform
that demands replacing the SCM will not be adopted.

Categories: SCM (GitHub/GitLab), CI (Actions/GitLab CI/Jenkins), ticketing (Jira,
internal), cloud (`CloudConnector` — AWS/Azure/GCP), runtime (Kubernetes), notify
(Slack/Discord/email).

Credentials for all of these go through one vault (AES-256-GCM, decision D6),
never per-integration ad-hoc storage.

---

## Ordering, and why

The dependency chain is real, not preference:

1. **Per-tenant ingest tokens** — the open gate bypass. Blocks every multi-tenant claim.
2. **Table ownership** (`findings`, `deployments`, `teams`, `builds`, `pipeline_runs`, `pipeline_state` are written directly to Appwrite by services and owned by no repository) — blocks §2, and blocks migrating `dashboard`/`deploy`/`gate`/`threats`.
3. **Normalized finding model** — §4 is the product; §5 and §6 both consume it.
4. **Credentials vault** — prerequisite for §8.
5. **CloudConnector + CSPM** — the tri-cloud capability.
6. **Policy engine consolidation**, then **event spine**.
7. Billing, onboarding, launch.

## What "industry ready" actually requires

Beyond features, and honestly: a real security audit by someone other than the
authors; tenant isolation proven rather than asserted; an SLA the free tier cannot
meet (Render free instances sleep); a documented incident response process; and
evidence the thing works — which means users. Four serious bugs surfaced today in
roughly a fifth of the codebase. The remaining four fifths have not been audited.

The gap to "industry ready" is not primarily more features. It is proof.
