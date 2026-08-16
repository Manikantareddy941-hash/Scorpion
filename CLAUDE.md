## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).

---

## Logging: winston, and the argument order is load-bearing

`backend/src/services/logger.ts` composes `winston.format.json()` **without**
`format.splat()`. That makes the call signature a correctness issue, not style:

```ts
logger.error('[X] failed', { event: 'X_FAILED', repoId, ...errorContext(err) });  // correct
logger.error({ event: 'X_FAILED' }, '[X] failed');                                // pino — DATA LOSS
logger.error('[X] failed', err.message);                                          // DROPPED entirely
```

- Object **second**. Passing it first makes it the message and parks the string
  on `Symbol(splat)`, which this logger never serialises.
- A **string** second argument is silently discarded — the reason is gone, the
  call site looks right, and a test asserting "it was passed to the logger" still
  passes. This class caused a 144-site migration; do not reintroduce it.
- A bare `Error` survives (winston appends the message and lifts `stack`) but is
  **unindexed** — no queryable `error` field. Use `...errorContext(err)`.
- Never spread a bare error: `{ ...err }` yields `{}` because `message` and
  `stack` are non-enumerable.

Event keys are `SUBSYSTEM_ACTION_FAILED` in SCREAMING_SNAKE. Two deliberate
exceptions where local parity beat the global convention: `terminal_*` in
`routes/terminalRoutes.ts` and `read_truncated`/`*_degraded` in the monitor
paths — existing SIEM rules key on those spellings.

## Gates — all four are enforced in ci.yml

| Gate | Value | Direction |
|---|---|---|
| `auditLoggerCalls.js` | `--max=0` | **Regression guard.** 0 is the destination; convert the call site, never raise the number |
| `auditResponseErrorLeaks.js` | `--max=31 --min=31` | **Bounded both ways.** The floor is real — see below |
| backend eslint | `--max-warnings=168` | Ratchet, lower only |
| frontend eslint | `--max-warnings=23` | Ratchet, **zero headroom** |

**The response-leak floor must never be swept to 0.** The 31 surviving sites are
19 403/409 authorization messages and 12 4xx Zod validation messages — the
caller's own access and the caller's own input. The tool cannot distinguish those
from an Appwrite error because all three are `.message`, which is why `--min`
exists. Deleting them breaks real client behaviour while making a security tool
report success.

An **eslint patch bump is a genuine ceiling risk** on both sides. Measure the
count; do not assume.

## Baselines

- backend: 186 suites, 1755 passing, 98 skipped (the 12 skipped suites are DB
  integration, gated on `RUN_DB_IT` + Docker — skipping is by design)
- frontend: 7 files, 51 tests; Playwright 10
- `npm audit --omit=dev --audit-level=high`: **0** on both trees, and CI enforces
  it with zero tolerance (no `--min` there — every high in a production tree is real)

## Traps that have cost time here

- **`git cherry` is inert under squash-merge.** Every merge here is a squash, so a
  merged commit never matches its constituents' patch-ids. It reports fully-landed
  work as "unique". Compare file **content**; measure a branch's footprint from its
  **merge-base**, never from `main`'s tip.
- **Branch names lie.** `feat/sca-reachability-enforcement` contains no
  reachability or call-graph code. It is the **only copy** of the api/worker
  process split (`worker.ts`, split k8s manifests) and the Postgres dual-write
  ingestion path. **Do not delete it.**
- **A stale branch's commits do not share a fate.** One branch here held three
  commits: one already landed, one obsolete, one still exploitable. Verify per
  claim against current `main`.
- **`const { id } = req.params` inside `try`** is not in scope in `catch`. Use
  `req.params.id` / `req.body?.x`. Seven occurrences so far; tsc catches it.
- **Dual-implementation facades** (Appwrite + Postgres) must move together, or the
  domain is only observable when `DATABASE_URL` happens to be set.
- **Scripts resolve `.env` from `process.cwd()`** and must run from `backend/`.

Operational configuration — cosign tiers, runner isolation, the provenance
migration — is in [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).
