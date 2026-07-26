// backend/src/scripts/sync_schema_attributes.ts
//
// Syncs the Appwrite schema with the union-tenancy code merged in PR #151:
//   - notifications: provision user_id + repo_id (the routes and notificationQueue
//     both write/read snake_case now), backfill from the legacy `userId`, and
//     only then optionally drop the stale attribute.
//   - incidents: ensure user_id exists for the tenant-scoped callers
//     (APM spikes / correlation) that own no repo.
//
// Run (from backend/, after `npm run build`):
//   node dist/backend/src/scripts/sync_schema_attributes.js
//
// The destructive drop of notifications.userId is OFF by default. Enable only
// after confirming the backfill reported 0 remaining rows:
//   DROP_LEGACY_USERID=1 node dist/backend/src/scripts/sync_schema_attributes.js
import { Client, Databases, Query } from 'node-appwrite';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// .env lives at backend/.env, but __dirname differs by how this is invoked:
// src/scripts under ts-node vs dist/backend/src/scripts once compiled. A single
// fixed '../../.env' is right for one and silently wrong for the other — it
// resolves to dist/backend/.env, loads nothing, and the Appwrite client then
// fails with "Endpoint must be a valid string". Try the candidates instead.
const ENV_CANDIDATES = [
  path.resolve(process.cwd(), '.env'),              // run from backend/ (documented)
  path.resolve(__dirname, '../../.env'),            // ts-node: src/scripts -> backend/
  path.resolve(__dirname, '../../../../.env'),      // compiled: dist/backend/src/scripts -> backend/
];
const envPath = ENV_CANDIDATES.find((p) => fs.existsSync(p));
if (!envPath) {
  console.error(`No .env found. Looked in:\n  ${ENV_CANDIDATES.join('\n  ')}`);
  process.exit(1);
}
dotenv.config({ path: envPath });
console.log(`Loaded env from ${envPath}`);

// Fail with a readable message rather than node-appwrite's opaque
// "Endpoint must be a valid string" when a var is missing.
const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env var(s): ${missing.join(', ')} (loaded ${envPath})`);
  process.exit(1);
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT as string)
  .setProject(process.env.APPWRITE_PROJECT_ID as string)
  .setKey(process.env.APPWRITE_API_KEY as string);

const databases = new Databases(client);
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID as string;
const DROP_LEGACY = process.env.DROP_LEGACY_USERID === '1';

/**
 * Each schema op gets its OWN error boundary. A shared try/catch would let the
 * first 409 ("already exists") skip every later step and report success —
 * the silent-partial-migration failure mode.
 */
async function ensureAttribute(collection: string, key: string, size = 255, required = false) {
  try {
    await databases.createStringAttribute(DATABASE_ID, collection, key, size, required);
    console.log(`  [+]    ${collection}.${key} created`);
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 409) console.log(`  [skip] ${collection}.${key} already exists`);
    else console.error(`  [FAIL] ${collection}.${key} — ${e.message}`);
  }
}

/**
 * Copies legacy `userId` into `user_id` so existing notifications keep their
 * owner. Without this, dropping userId orphans every historical row: the new
 * read path filters on user_id and would return nothing for them.
 * Returns the number of rows still missing user_id.
 */
async function backfillNotificationOwner(): Promise<number> {
  let cursor: string | undefined;
  let migrated = 0;
  let remaining = 0;

  for (;;) {
    const queries = [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
    let page;
    try {
      page = await databases.listDocuments(DATABASE_ID, 'notifications', queries);
    } catch (err: unknown) {
      console.error(`  [FAIL] backfill read — ${(err as { message?: string }).message}`);
      return -1;
    }
    if (page.documents.length === 0) break;

    for (const doc of page.documents) {
      const row = doc as unknown as Record<string, unknown>;
      if (row.user_id) continue;
      const legacy = row.userId;
      if (typeof legacy !== 'string' || !legacy) { remaining++; continue; }
      try {
        await databases.updateDocument(DATABASE_ID, 'notifications', doc.$id, { user_id: legacy });
        migrated++;
      } catch (err: unknown) {
        console.error(`  [FAIL] backfill ${doc.$id} — ${(err as { message?: string }).message}`);
        remaining++;
      }
    }

    cursor = page.documents[page.documents.length - 1].$id;
    if (page.documents.length < 100) break;
  }

  console.log(`  [=]    backfilled ${migrated} row(s); ${remaining} still without an owner`);
  return remaining;
}

async function run() {
  console.log('notifications: provisioning union-owner attributes...');
  // Optional, NOT required: Appwrite refuses a required attribute on a
  // collection that already holds documents (they have no value for it).
  await ensureAttribute('notifications', 'user_id');
  await ensureAttribute('notifications', 'repo_id');

  console.log('\nincidents: ensuring tenant-scoped owner...');
  await ensureAttribute('incidents', 'user_id');

  console.log('\nAttributes provision asynchronously — waiting 30s before the backfill.');
  await new Promise((r) => setTimeout(r, 30_000));

  console.log('\nnotifications: backfilling user_id from legacy userId...');
  const remaining = await backfillNotificationOwner();

  if (!DROP_LEGACY) {
    console.log('\nSkipping the drop of notifications.userId (DROP_LEGACY_USERID is not set).');
    console.log('Re-run with DROP_LEGACY_USERID=1 once the backfill reports 0 remaining.');
  } else if (remaining !== 0) {
    console.error(`\nREFUSING to drop notifications.userId — ${remaining} row(s) have no user_id.`);
    console.error('Dropping now would orphan them. Resolve those rows first.');
  } else {
    try {
      await databases.deleteAttribute(DATABASE_ID, 'notifications', 'userId');
      console.log('\n  [-]    notifications.userId dropped');
    } catch (err: unknown) {
      console.error(`  [FAIL] dropping notifications.userId — ${(err as { message?: string }).message}`);
    }
  }

  console.log('\nNext: wait ~30s for provisioning, then re-run add_indexes to pick up');
  console.log('notifications.idx_user_id / idx_repo_id and incidents.idx_user_id:');
  console.log('  node dist/backend/src/scripts/add_indexes.js');
}

run();
