# ADR 0001 — Phase 1: security hardening and observability of silent failures

**Status:** Accepted · **Date:** 2026-08-16 · **PRs:** #272, #273, #274, #275

## Context

These four changes did not come from a backlog. They came from auditing five
stale local branches during a cleanup task, and the audit method is the reason
they were found at all — so it is recorded here alongside the decisions.

Two measurement traps shaped the work:

**`git cherry` is inert under squash-merge.** Every merge in this repository is a
squash, so a merged commit never shares a patch-id with its constituents. It
reported all 37 unmerged commits as unique, including files byte-identical to
`main`. Only file-content comparison distinguished landed work from stranded work.

**A stale branch's commits do not share a fate.** One branch held three commits
that split three ways: one already landed via another route, one obsolete, and
one describing a vulnerability still live on `main`. Branch age and name
predicted nothing.

## Decisions

### 1. SSRF guard at the choke point, not at configuration time (#272)

`jiraRequest` built every outbound call from `currentJiraConfig.baseUrl` — a
user-supplied value — with no validation, making the server an SSRF proxy.

`assertSafeWebhookUrl` already existed in `utils/ssrfGuard.ts` and was already
used by `routes/alerts.ts`. The decision was **where** to call it.

Chosen: inside `jiraRequest`, not `setJiraConfig`.

- It is the single choke point all Jira traffic passes through, so one check
  covers every call site.
- The config is **mutable at runtime**; validating only at set time leaves every
  later call trusting a value that may since have been replaced.

The guard's https requirement is a second benefit: it stops the Basic auth header
— carrying the API token — from being sent in cleartext.

**Test principle:** the assertion is that `axios` was *never called*. A test
checking only for an error return would pass even if the request went out and
failed on its own, which is exactly the outcome the guard prevents.

### 2. Ingestion auth binds the tenant to the credential, not the body (#273)

`POST /api/metrics` and `POST /api/logs` had no authentication and wrote a
caller-supplied `repoId` straight to Appwrite — `/api/logs` into `audit_logs`.
Anyone reachable could forge audit entries against any repository.

Two caller kinds exist (headless agents and browsers), so a hybrid credential was
required: `x-api-key` first, session as fallback.

The decision that matters is **what the credential is checked against**. Proving
a credential valid is insufficient, because `repoId` arrives in the body and the
body is caller-controlled — a genuine token for tenant A would otherwise write
against tenant B. Both paths resolve the repository and compare it to the
identity the credential itself carries, taking the tenant from the token
(`team_id ?? user_id`) exactly as `middleware/ciApiKey.ts` does.

Built on existing primitives (`ciTokenRepository.verify`, `canAccessResource`)
rather than new services.

**Fails closed:** if the access check throws, the request is refused with 503. A
gate that opens during a storage outage is not a gate.

### 3. Email verification: soft enforcement, and the read that was missing (#274)

Verification was three-quarters built and its answer discarded — signup fired
`createVerification`, `/verify-email` exchanged the link, Appwrite flipped
`emailVerification`, and **nothing read the flag**. Users were asked to verify and
nothing depended on it.

Soft enforcement over a hard gate: registration is public, but
`createVerification` soft-fails when the project has no SMTP, so a self-hosted
install *cannot* produce a verified user. A hard gate would lock those
deployments out entirely. The dashboard stays open; four abusable actions are
gated (CI tokens, invites, alert integrations, report export).

`DELETE` on tokens is deliberately ungated — revoking a credential is never the
abusive direction. Export is gated on both verbs, because the `GET` form accepts
`?token=` for browser downloads.

**The middleware requires the literal `true`.** The opt-in dev bypass installs a
mock user with no `emailVerification` field, so `!user.emailVerification` reads
`undefined` as unverified and 403s every request in local development. Absence
therefore fails **closed** for real users, with the bypass identity named
explicitly and gated on the same non-production condition the bypass itself uses.

### 4. Silent failures need queryable signals, not prose (#275)

`RUNNER_MODE=kubernetes` is the only path to isolated zero-egress execution, and
the auto-probe can never select it. A deployment meant to be isolated and isn't
looks identical to a healthy one: scans succeed, just outside isolation.

The boot line announcing the mode was a plain interpolated string — visible but
not alertable. It survived the 144-site event-key migration because that pass
targeted `logger.error`/`warn` in catch blocks, not boot-time `info`.

Now emitted as `RUNNER_MODE_SELECTED` with `mode`, `configuredMode`,
`isFallback`, `isolated`, `zapAvailable`, `falcoAvailable`.

**Alert on `isolated == false`, not `isFallback == true`.** The latter is true
whenever the mode was not explicitly requested — unset included — so it fires on
every default-configured developer machine. `isolated` matches the actual
requirement and stays correct if a fourth runner mode is added.

## Consequences

- Failure modes are now matched to signal shape: the cosign supply-side gap fails
  loudly in CI; the runner-isolation gap is queryable; the deploy-key
  misconfiguration is caught at boot by `probeSigningReadiness` rather than
  mid-release.
- `probeSigningReadiness` had **no tests** despite being that safety net
  (26% branch coverage on `cosignService.ts`). Covered subsequently, taking branch
  coverage to 87%, so the states `OPERATIONS_RUNBOOK.md` documents are pinned to
  executable assertions and cannot drift from the prose.
- Three existing route suites had to be updated for #274 — their mock users
  predate the flag, so the gate correctly rejected them. Fixed rather than
  bypassed.
- `feat/sca-reachability-enforcement` is retained: despite its name it holds no
  reachability code and is the only copy of the api/worker process split and
  Postgres dual-write ingestion.
