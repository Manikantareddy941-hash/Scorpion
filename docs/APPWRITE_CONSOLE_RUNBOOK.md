# Appwrite console runbook

Two jobs that cannot be done from code. Both are in the Appwrite console.

Written after the frontend→backend migration (PRs #112–#117), which moved every
direct browser database call onto tenant-scoped backend endpoints.

---

## Job 1 — Create the `reports` collection

Without this, `GET`/`POST /api/reports/history` return 500 and the "Recent
Reports" panel on the Reports page stays empty. (It has never worked: the
frontend previously passed `undefined` as the collection id.)

**Database:** the one in `VITE_APPWRITE_DATABASE_ID`
**Collection ID:** `reports` (exact string — `backend/src/lib/appwrite.ts` hardcodes it)

### Attributes

| Key | Type | Size | Required | Notes |
|---|---|---|---|---|
| `userId` | String | 64 | yes | owner; written from the session, never the request body |
| `title` | String | 512 | yes | |
| `type` | String | 32 | yes | `pdf` or `csv` |
| `repositoryId` | String | 64 | no | may be empty string |
| `status` | String | 32 | yes | currently always `completed` |
| `createdAt` | String | 64 | yes | ISO 8601, written by the backend |
| `data` | String | 65536 | no | JSON blob: the export's date range |

### Index

| Key | Type | Attribute | Order |
|---|---|---|---|
| `userId_idx` | key | `userId` | ASC |

Required — `GET /api/reports/history` runs `Query.equal('userId', …)`.
Sorting uses the built-in `$createdAt`, so no index is needed for it.

### Permissions

**Grant nothing to any role.** Leave the permission list empty.

The backend reaches this collection with an API key, which bypasses collection
permissions. An empty list means the browser cannot touch it directly — which
is the point.

### Verify

1. Reports page → export a PDF.
2. The file downloads **and** the entry appears under Recent Reports.
3. Sign in as a second user → their Recent Reports list does **not** show the
   first user's export.

If step 3 fails, the endpoint is fine but the collection has browser-readable
permissions — go back and clear them.

---

## Job 2 — Audit collection permissions (the important one)

This is the item that has been open longest, and it is the one that decides
whether the tenancy boundary is real.

**Why it still matters after the migration.** Everything in #112–#117 changed
what the browser *asks for*. Collection permissions decide what it is *allowed*
to get. A user can still open devtools and call the Appwrite SDK directly with
their own session. If a collection grants `read` to `users` (any authenticated
user), every row in it is readable by every customer — regardless of how
careful the app code now is.

### What the browser legitimately still needs

After the migration, the frontend uses Appwrite for only four things:

| Need | Appwrite surface |
|---|---|
| Login / session | `account` |
| Avatar upload | `storage` (bucket `69ba01e5000964e8c2c0`) |
| AI remediation call | `functions` |
| Live scan progress | `databases` **realtime subscriptions only** |

`databases` read/write calls from the browser are down to one file:
`src/lib/demoData.ts`, and it now only runs when `VITE_DEMO_MODE=true`.

### Target state per collection

**Realtime subscriptions** — these three need document-level `read` for the
owning user, because a realtime event is only delivered to a session that can
read the document:

- `scans`
- `vulnerabilities`
- `findings` (same underlying collection as `vulnerabilities` on the backend;
  the frontend has separate env vars for them)

Set these **per-document** (`Permission.read(Role.user(<ownerId>))` stamped at
create time), never collection-wide `read(Role.users())`. Collection-wide
`users` read on `vulnerabilities` means every customer reads every finding.

**Everything else — grant nothing.** The backend uses an API key:

```
repositories            notification_preferences   policy_evaluations
notifications           policies                   integrations
chat_sessions           commits                    builds
test_runs               releases                   audit_logs
certificates            threats                    build_pipelines
deployments             tasks                      reports
```

`integrations` matters most in that list — it holds Slack/Discord webhook URLs
and PagerDuty keys. Anyone who can read a webhook URL can post to that channel.

### How to check each one

Console → Databases → *(your database)* → collection → **Settings → Permissions**.

For every collection, ask: **is there any entry granting `read` to `Any` or
`Users`?** If yes, and it is not one of the three realtime collections above,
that collection is readable across tenants. Remove it.

Also check **Document security** is ON for the three realtime collections —
without it, document-level permissions are ignored and the collection-level
list governs everything.

### Verify

The check that actually proves it, in two accounts:

1. Sign in as user A. Devtools console:
   ```js
   const { databases, DB_ID, COLLECTIONS } = await import('/src/lib/appwrite.ts');
   await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS);
   ```
2. Expect a **401/permission error**, not a document list.
3. Repeat for `REPOSITORIES` and `NOTIFICATIONS`.
4. For `VULNERABILITIES`, expect **only user A's findings** — not zero, not
   everyone's.

A result of "zero documents" for step 4 means realtime will silently stop
updating scan progress. A result of "everyone's documents" means the boundary
is still open.

---

## Known-unfixable-from-here, for the record

- **Avatar upload** writes to Appwrite storage directly from the browser
  (`src/pages/Settings.tsx`). Bucket permissions are the only control on it.
- **`demoData.ts`** still holds the last browser `databases` writes. Removing
  them is what unblocks dropping the `databases` export from
  `src/lib/appwrite.ts` entirely.
