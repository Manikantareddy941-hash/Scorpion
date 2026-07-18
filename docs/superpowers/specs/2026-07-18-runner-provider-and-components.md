# RunnerProvider + Essential Component Architecture

Date: 2026-07-18
Status: design approved by owner, implementation starting
Supersedes nothing; implements decision **D3** from `2026-07-17-saas-productionization-design.md`

---

## Part 1 — Why this comes before finishing the repository rollout

Scorpion has never run anywhere but a developer laptop. There is no `fly.toml`,
no `render.yaml`, no hosting config of any kind in the repository.

Every scanner execution path requires a Docker daemon:

| Path | Mechanism | Hosted-viable? |
|---|---|---|
| `scan/orchestrator.ts` → `executeTool()` | `spawn('docker', ['run', '-v', …])` | No — needs daemon + bind mount |
| `dockerRunnerService.ts` | `dockerode` + `HostConfig.Binds` | No — needs socket + bind mount |
| `containerizedTrivyService.ts`, `iacService.ts`, `pipelineService.ts` | call the above | No |

Free-tier Fly/Render provide neither a Docker socket nor privileged mode.
**Deployed today, every scan in Scorpion would fail.** The remaining seven
repository migrations are plumbing on a product that cannot perform its one job.

A stale comment in `containerizedTrivyService.ts` claims `scanService.ts` runs
the main pass "directly via execFile". It does not — it only spawns `git`. No
binary execution path exists anywhere. Comment to be corrected.

## Part 2 — RunnerProvider design

### The seam

`executeTool(toolId, userArgs, toolName)` in `scan/orchestrator.ts` already maps
a tool name to a container image and rewrites path arguments for the mount. That
signature *is* the abstraction — it just has exactly one hardcoded strategy.
RunnerProvider makes the strategy selectable without changing callers.

```ts
export interface ToolRun {
  tool: string;            // 'trivy' | 'semgrep' | …
  args: string[];          // tool arguments, host paths
  workspacePath: string;   // host dir the tool reads
  timeoutMs: number;
}

export interface ToolResult { stdout: string; stderr: string; exitCode: number | null }

export interface RunnerProvider {
  readonly mode: 'docker' | 'binary';
  supports(tool: string): boolean;
  run(run: ToolRun): Promise<ToolResult>;
}
```

### Two implementations

**DockerRunner** — current behaviour, extracted unchanged. Mounts the workspace,
rewrites host paths to the container path. Remains the default for local dev and
any self-hosted install that has a daemon.

**BinaryRunner** — `spawn(binaryPath, args, { cwd: workspacePath })`. No mount,
no rewrite: the tool reads host paths directly, which is *simpler* than the
Docker path, not harder. Resolves binaries from `SCORPION_BIN_DIR` (defaulting to
`PATH`) so a deployment can ship pinned binaries in the image.

### Selection and capability

`RUNNER_MODE=docker|binary|auto` (default `auto`). Auto probes for a reachable
Docker daemon once at boot and falls back to binary.

Per-tool capability is not uniform, and pretending otherwise would ship a product
that silently returns empty results:

| Tool | Binary mode | Reason |
|---|---|---|
| Trivy | Yes | single static Go binary |
| Gitleaks | Yes | single static Go binary |
| Semgrep | Yes | pip-installable |
| Checkov | Yes | pip-installable |
| Hadolint | Yes | single static Haskell binary |
| ZAP | **No** | JVM + browser stack; docker-only per D3 |
| Falco | **No** | kernel eBPF; a cluster agent, not a hosted process |

`supports()` returns false for ZAP/Falco under binary mode. A scan requesting an
unsupported tool must surface an explicit `unavailable` status to the user —
**never** a silent empty result. Reporting "0 findings" when the scanner never
ran is a security lie, and is the single most dangerous failure mode in this
change. Note the existing `executeTool` error path already resolves an empty
`{"Results":[]}` on spawn failure — that pre-existing silent-pass bug gets fixed
as part of this work.

### Failure semantics

- Tool unavailable in this mode → `unavailable` status, surfaced in the UI, never counted as "clean".
- Tool ran and exited non-zero with parseable output → normal findings path (most scanners exit non-zero when they find things).
- Tool ran and produced unparseable output → `error` status, surfaced. Not "clean".

## Part 3 — Essential component architecture

What a sellable multi-tenant DevSecOps SaaS needs, and where Scorpion stands.
This is the inventory that governs the rest of the roadmap.

### Built and solid

| Component | State |
|---|---|
| Scan orchestration (SAST/SCA/secrets/IaC/container) | works, Docker-bound — this change fixes that |
| Policy & gate engine (gate rules, pod security, suppressions) | works, Postgres-backed |
| Runtime monitoring (Falco rules, drift, posture, correlation) | works, Postgres-backed |
| SOAR playbooks & actions | works, Postgres-backed |
| Threat modelling | works, Postgres-backed |
| Findings → tickets workflow | works, **in-memory comments/activity — data lost on restart** |
| CI ingestion endpoint (`/ingest/scan`) | exists, needs auth tokens |

### Missing — required to sell

| Component | Why essential | Phase |
|---|---|---|
| **RunnerProvider** | product cannot run hosted without it | now |
| **Hosted deployment** | nobody can evaluate localhost | next |
| **Tenancy audit** | tenant A seeing tenant B's findings makes it unsellable — needs systematic proof, not spot checks | next |
| **Credentials vault** (AES-256-GCM) | prerequisite for any cloud connector | Phase 2 |
| **CloudConnector + Prowler CSPM** | the actual AWS/Azure/GCP capability you asked for | Phase 2 |
| **CI ingestion tokens** | scoped auth so a customer's pipeline can push results | Phase 2 |
| **Onboarding wizard** | evaluators who can't get to first scan in 10 minutes leave | Phase 3 |
| **Billing** | Paddle/LemonSqueezy | Phase 3 |

### Structural debt to fix, in priority order

1. **Table ownership.** `findings`, `deployments`, `teams`, `builds`, `pipeline_runs`, `pipeline_state` are written directly to Appwrite by services, owned by no repository. This blocks migrating `dashboard`, `deploy`, `gate`, and `threats`, and it violates the layering rule in `backend/CLAUDE.md`. Needs its own design pass.
2. **Tickets in-memory maps.** Comments, activity and links live in module-level `Map`s — silent data loss on every restart. Migrating tickets to Postgres fixes a live bug, it is not just a port.
3. **Three execution paths.** `orchestrator` spawn-docker, `dockerRunnerService` dockerode, and direct `spawn` calls. RunnerProvider collapses these.
4. **`DATABASE_URL` is overloaded across two data layers — deployment blocker.**

### The DATABASE_URL collision (found 2026-07-18, blocks hosted deploy)

An earlier note in this program recorded `prisma generate` as a dead build-script
reference. **That was wrong.** Prisma is live and installed: `prisma/schema.prisma`,
`prisma/schema.postgres.prisma`, `prisma/migrations/`, a generated client in
`src/generated/prisma/`, and both `prisma` and `@prisma/client` in `package.json`.
It backs a narrow durable audit store — one `ScanResult` model (image digest →
reachability counts), written by `scanAudit.ts`, with Redis as the hot path.

The problem is that **two independent data layers now read the same environment
variable**:

- `db/pool.ts` → `isPostgresEnabled()` treats any `DATABASE_URL` as "use the Postgres repositories"
- `prismaClient.ts` → `createAdapter(process.env.DATABASE_URL)` picks SQLite vs Postgres from the URL *scheme*

Setting `DATABASE_URL=postgres://…` therefore flips **both** at once. But the
Postgres schema is managed by `node-pg-migrate` (`backend/migrations/*.sql`),
which knows nothing about Prisma's model. Verified against the live dev database:
14 tables exist and **`ScanResult` is not among them**.

So in any Postgres deployment, `scanAudit.ts` writes fail with
`relation "ScanResult" does not exist`. This is latent today only because the test
suites do not exercise that path against a real Postgres.

Options, to be decided before deployment:

1. Fold `ScanResult` into `node-pg-migrate` and drop Prisma entirely — one migration tool, one schema authority. Simplest, and Prisma earns little for a single model.
2. Run `prisma migrate deploy` in CI/boot alongside `node-pg-migrate` — keeps Prisma but means two migration systems on one database.
3. Give Prisma its own `PRISMA_DATABASE_URL` — decouples the two, at the cost of another env var to configure correctly.

Recommendation: **option 1**. A single model does not justify a second ORM, a
second migration tool, and a generated client in version control.

### Explicitly out of scope

Not building: agentless cloud workload scanning, container registry integration,
SIEM export, SSO/SAML, or an on-prem installer. Each is real enterprise demand
and each is its own multi-week subsystem. They are the *next* product, not the
one that gets to a first paying customer.

## Part 4 — Build order

1. RunnerProvider interface + DockerRunner (behaviour-preserving extraction, tests pin current behaviour)
2. BinaryRunner + capability matrix + `unavailable` status plumbed to the UI
3. Fix the silent empty-result path in `executeTool`
4. Wire `dockerRunnerService` callers onto the provider
5. Hosted deployment + tenancy audit (separate plan)
