// backend/src/scripts/lock_collection_permissions.ts
//
// Removes client-facing permission grants from Appwrite collections, so the
// backend API (which enforces tenancy) is the only path to the data.
//
// Why: the frontend Appwrite client authenticates as the end user's session —
// or as nobody at all. A grant to `users` is readable/writable by every
// logged-in customer; a grant to `any` needs no authentication whatsoever, and
// the endpoint and project id ship in the frontend bundle. Either bypasses
// every control the API enforces.
//
// The audit (audit_collection_permissions.ts) found 12 such collections,
// including `pipeline_state` — which holds the release-gate verdict — with
// full create/update/delete("any"). That is a gate anyone can flip.
//
// Scope of the change, deliberately narrow:
//   - strips ONLY grants to `any` and `users`
//   - PRESERVES scoped grants (user:… / team:…), which are the intended model
//   - preserves name, documentSecurity and enabled (read back and passed
//     through, so this never silently resets a collection's other settings)
//   - never passes `purge`
//
// Dry run by default. Nothing is written without APPLY=1:
//   node dist/backend/src/scripts/lock_collection_permissions.js
//   APPLY=1 node dist/backend/src/scripts/lock_collection_permissions.js
//
// Known functional consequence: browser realtime subscriptions to a locked
// collection stop delivering events (Appwrite applies the same permissions to
// realtime). JourneyMap subscribes to pipeline_state and threats. Those
// handlers only ever trigger a refetch through the API, so the pages stay
// correct — they just stop being push-updated. That is the right trade, but it
// IS a visible behaviour change.
import { Client, Databases, Query, Models } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env var(s): ${missing.join(', ')}`);
  process.exit(1);
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT as string)
  .setProject(process.env.APPWRITE_PROJECT_ID as string)
  .setKey(process.env.APPWRITE_API_KEY as string);

const databases = new Databases(client);
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID as string;
const APPLY = process.env.APPLY === '1';

/** Roles that mean "everyone": `any` is unauthenticated, `users` is any session. */
const OPEN_ROLES = ['any', 'users'];

function isOpenToAllSessions(permission: string): boolean {
  const role = permission.match(/^\w+\("([^"]+)"\)/)?.[1];
  return role !== undefined && OPEN_ROLES.includes(role);
}

/**
 * Paginates. listCollections caps at 25 per page while `total` reports the
 * full count — the audit's first version missed 41 of 66 collections that way
 * and reported all-clear. Fails loudly rather than acting on a partial list.
 */
async function listAllCollections(): Promise<Models.Collection[]> {
  const all: Models.Collection[] = [];
  let cursor: string | undefined;
  let total = 0;

  for (;;) {
    const queries = [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
    const page = await databases.listCollections(DATABASE_ID, queries);
    total = page.total;
    all.push(...page.collections);
    if (page.collections.length === 0 || all.length >= total) break;
    cursor = page.collections[page.collections.length - 1].$id;
  }

  if (all.length !== total) {
    throw new Error(`Fetched ${all.length} of ${total} collections — refusing to act on a partial list.`);
  }
  return all;
}

async function run() {
  console.log(APPLY ? 'APPLYING permission lockdown\n' : 'DRY RUN — no writes. Set APPLY=1 to execute.\n');

  let collections: Models.Collection[];
  try {
    collections = await listAllCollections();
  } catch (err) {
    console.error(`Failed to list collections — ${(err as { message?: string }).message}`);
    process.exit(1);
  }

  const targets = collections
    .map((c) => {
      const permissions = (c.$permissions ?? []) as string[];
      const open = permissions.filter(isOpenToAllSessions);
      const kept = permissions.filter((p) => !isOpenToAllSessions(p));
      return { collection: c, open, kept };
    })
    .filter((t) => t.open.length > 0);

  if (targets.length === 0) {
    console.log('No collection grants access to `any` or `users`. Nothing to do.');
    return;
  }

  console.log(`${targets.length} collection(s) to lock:\n`);
  let failed = 0;

  for (const { collection, open, kept } of targets) {
    console.log(`  ${collection.$id}`);
    console.log(`    remove : ${open.join(', ')}`);
    console.log(`    keep   : ${kept.length > 0 ? kept.join(', ') : '(none — backend key only)'}`);

    if (!APPLY) continue;

    // Own error boundary per collection: a shared try/catch would let the first
    // failure skip every collection after it and still look like a clean run.
    try {
      await databases.updateCollection({
        databaseId: DATABASE_ID,
        collectionId: collection.$id,
        name: collection.name,               // preserved — omitting it renames
        permissions: kept,
        documentSecurity: collection.documentSecurity,
        enabled: collection.enabled,
      });
      console.log('    [OK]   locked');
    } catch (err) {
      failed++;
      console.error(`    [FAIL] ${(err as { message?: string }).message}`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with APPLY=1 to write these changes.');
    return;
  }

  console.log(`\n${targets.length - failed} locked, ${failed} failed.`);
  console.log('Verify with: node dist/backend/src/scripts/audit_collection_permissions.js');
  if (failed > 0) process.exit(1);
}

run();
