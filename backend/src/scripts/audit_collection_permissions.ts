// backend/src/scripts/audit_collection_permissions.ts
//
// READ-ONLY audit. Reports which Appwrite collections are readable by the
// browser, and therefore which ones have Appwrite permissions — not the
// backend's tenancy checks — as their only isolation boundary.
//
// Why this matters: the frontend Appwrite client authenticates as the end
// user's session. Anything that grants read to `any` or `users` is readable by
// every logged-in customer, directly and over realtime websockets, bypassing
// every control the API enforces. Removing the frontend `databases` export
// (PR #155) removed the means to *query* it; it does not change what the
// transport layer will still stream to a subscriber.
//
// Run (from backend/, after `npm run build`):
//   node dist/backend/src/scripts/audit_collection_permissions.js
//
// Exits 1 if any collection is client-readable, so this can gate CI.
import { Client, Databases, Query } from 'node-appwrite';
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

/**
 * Appwrite permission strings look like read("any") / read("users") /
 * read("user:abc") / read("team:xyz"). Only the first two are open to every
 * logged-in session; user:/team: scoped grants are the intended model.
 */
const OPEN_ROLES = ['any', 'users'];

// Every verb, not just read. A write grant is strictly worse: `pipeline_state`
// holds the release-gate verdict, so an open create/update there means any
// session can flip a gate, not merely observe one.
function readGrants(permissions: string[]): string[] {
  return permissions.filter((p) => /^(read|create|update|delete|write)\(/.test(p));
}

function isOpenToAllSessions(permission: string): boolean {
  const role = permission.match(/^\w+\("([^"]+)"\)/)?.[1];
  return role !== undefined && OPEN_ROLES.includes(role);
}

/**
 * Paginates. listCollections caps at 25 per page, so a single call silently
 * inspects a fraction of the database while `total` still reports the full
 * count — an audit that reports "all clear" on collections it never read is
 * worse than no audit.
 */
async function listAllCollections() {
  const all: Awaited<ReturnType<typeof databases.listCollections>>['collections'] = [];
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
  return { all, total };
}

async function run() {
  let all, total;
  try {
    ({ all, total } = await listAllCollections());
  } catch (err) {
    console.error(`Failed to list collections — ${(err as { message?: string }).message}`);
    process.exit(1);
  }

  const risky: string[] = [];
  const clientReadable: string[] = [];

  console.log(`Auditing ${all.length} of ${total} collection(s) in ${DATABASE_ID}\n`);
  if (all.length !== total) {
    console.error(`Only fetched ${all.length} of ${total} collections — audit is incomplete.`);
    process.exit(1);
  }

  for (const c of all) {
    const perms = (c.$permissions ?? []) as string[];
    const reads = readGrants(perms);
    const open = reads.filter(isOpenToAllSessions);

    // documentSecurity means per-document permissions also apply, which can
    // legitimately narrow a collection-level grant — call it out rather than
    // silently treating the collection grant as the whole story.
    const docSec = c.documentSecurity ? ' [documentSecurity ON]' : '';

    if (open.length > 0) {
      risky.push(c.$id);
      console.log(`  RISK  ${c.$id}${docSec} — ${open.join(', ')}`);
    } else if (reads.length > 0) {
      clientReadable.push(c.$id);
      console.log(`  scoped ${c.$id}${docSec} — ${reads.join(', ')}`);
    } else {
      console.log(`  ok    ${c.$id}${docSec} — no client read permission`);
    }
  }

  console.log('\n--- summary ---');
  console.log(`open to any/users : ${risky.length}${risky.length ? ` (${risky.join(', ')})` : ''}`);
  console.log(`scoped client read: ${clientReadable.length}${clientReadable.length ? ` (${clientReadable.join(', ')})` : ''}`);
  console.log(`backend-only      : ${all.length - risky.length - clientReadable.length}`);

  if (risky.length > 0) {
    console.error(
      '\nThese collections are readable by every logged-in session, over REST and realtime,' +
      '\nregardless of the tenancy the API enforces. Restrict them, or move to' +
      '\ndocumentSecurity with per-document user/team permissions stamped on write.',
    );
    process.exit(1);
  }
  console.log('\nNo collection is open to all sessions.');
}

run();
