# Migrating frontend reads off direct Appwrite

Date: 2026-07-18
Status: plan. Implements requirement §2 and §3 of
`2026-07-18-unified-platform-architecture.md` (one storage authority; tenant
identity enforced structurally).

## The problem, stated without needing the console

`src/lib/appwrite.ts` builds a public web-SDK client (endpoint + project id, no
API key), so browser queries run as the user's Appwrite session. **106 direct
`databases.*` calls** across ~20 components then query domain collections
straight from the browser, with no tenant filter:

```ts
// Dashboard.tsx — every open vulnerability, unfiltered
databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
  Query.equal('status', 'open'), Query.limit(1),
]);
```

For every one of those reads, Appwrite collection permissions are the entire
tenancy boundary. The backend controls added in PRs #93/#95/#96/#97 are bypassed
because the browser never calls the backend.

Live permission state is not in the repo, so the outcome is one of two — **and
both are defects with the same fix**:

| Appwrite collection permission | Consequence |
|---|---|
| readable by `Role.users()` | Every logged-in customer reads every other customer's vulnerabilities. Not an attack; it renders. |
| server-key only (backend default) | Every such query throws, the `catch` logs a warning, and the security dashboard renders **zeros**. |

The second is not the safe case. A dashboard reporting "0 open vulnerabilities"
because its query failed is the same lie as a crashed scanner reporting
"0 findings" — the bug fixed in PR #89. Silence on a security surface reads as
safety.

Note the demo fallback is *not* implicated: it is gated on an explicit
`localStorage scorpion_demo_seeded` flag, which is honest behaviour.

## Target

Domain reads go through the backend API, which already enforces tenancy.
Appwrite keeps identity only — architecture spec decision D2.

## Order of work

Highest-risk collections first, because they hold security findings and because
they are the ones a customer would notice.

### Slice 1 — security data (do first)
`VULNERABILITIES`, `FINDINGS`, `SCANS`, `REPOSITORIES`.
Consumers: `Dashboard.tsx`, `TopVulnerabilities.tsx`, `Issues.tsx`,
`ProjectDetail.tsx`, `MultiRepoDashboard.tsx`, `VerifyScan.tsx`.
Backend endpoints largely exist already (`/api/vulns`, `/api/findings`,
`/api/repos`, `/api/dashboard/security`) — this is mostly swapping the call, not
writing new APIs. Verify each endpoint's tenant scoping before relying on it.

### Slice 2 — operational data
`INTEGRATIONS`, `TASKS`, `POLICIES`, `NOTIFICATIONS`, `ALERTS`.

### Slice 3 — everything remaining
`CHAT_SESSIONS`, `COMMITS`, `BUILDS`, `TEST_RUNS`, analysis pages.

### Slice 4 — close the door
Remove `databases` from the frontend Appwrite export so a direct domain query
cannot be reintroduced. `account` stays for auth. This is the step that makes
the fix durable rather than a one-off cleanup — without it the next component
re-adds a direct query and nobody notices.

## Non-negotiable during the migration

**A failed fetch must not render as zero.** Every migrated call surfaces an
error state to the user. `catch { console.warn }` leaving a 0 on screen is
forbidden on any security-count surface; the UI must be able to say "couldn't
load" and be visibly different from "nothing found". This is the same invariant
as the runner's `unavailable` status.

## Independently of this plan

Check the live console — Appwrite → Database → each collection → Settings →
Permissions. It does not change the work, but it decides whether there is an
active data leak to disclose, and whether today's dashboards have been showing
real numbers or zeros. That is worth knowing either way.
