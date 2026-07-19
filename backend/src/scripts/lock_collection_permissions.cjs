/**
 * Collection permission audit + lockdown.
 *
 * Context: 15 of 25 collections grant blanket access to any authenticated user
 * (`read("users")` etc), and chat_sessions grants `any` — unauthenticated
 * public read/write/delete. The backend reaches every collection with a server
 * API key, which bypasses collection permissions, so removing browser grants
 * does not affect the API. It only closes the direct-from-devtools path.
 *
 * Usage:
 *   node src/scripts/lock_collection_permissions.cjs                 # dry run, changes nothing
 *   node src/scripts/lock_collection_permissions.cjs --apply <id>    # apply to one collection
 *
 * The dry run prints the exact before/after for every collection and a
 * rollback line per change. Nothing is applied without --apply and an explicit
 * collection id.
 *
 * NOT handled here: the three realtime collections (scans, vulnerabilities,
 * findings) need document-level read for the owner before their collection
 * grants can be removed, or realtime scan progress goes dead and existing
 * documents become unreadable. That backfill is a separate step.
 */
const sdk = require('node-appwrite');
require('dotenv').config({ path: '.env' });

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new sdk.Databases(client);
const DB = process.env.APPWRITE_DATABASE_ID;

// Browser realtime subscriptions need read on these; they are deliberately
// excluded from lockdown until per-document permissions are backfilled.
//
// `findings` is NOT in this set despite Alerts.tsx subscribing to it. The
// backend's COLLECTIONS.FINDINGS maps to the `vulnerabilities` collection
// (backend/src/lib/appwrite.ts), so nothing ever writes the Appwrite `findings`
// collection - that subscription has never fired. Its 350 documents are legacy
// and carry no repo_id, so they cannot be owner-resolved either. It locks like
// any other collection.
const REALTIME = new Set(['scans', 'vulnerabilities']);

const isBroad = (p) => /\("users"\)|\("any"\)/.test(p);

async function main() {
  const applyIdx = process.argv.indexOf('--apply');
  const target = applyIdx > -1 ? process.argv[applyIdx + 1] : null;

  if (applyIdx > -1 && !target) {
    console.error('--apply requires a collection id');
    process.exit(1);
  }

  const { collections } = await db.listCollections(DB);

  if (!target) {
    console.log('DRY RUN — nothing will be changed.\n');
    let n = 0;
    for (const c of collections) {
      const broad = (c.$permissions || []).filter(isBroad);
      if (!broad.length) continue;
      n++;
      const tag = REALTIME.has(c.$id) ? 'SKIP (realtime — needs doc-perm backfill first)' : 'LOCK';
      console.log(`[${tag}] ${c.$id}  documentSecurity=${c.documentSecurity}`);
      console.log(`   before: ${JSON.stringify(c.$permissions)}`);
      console.log(`   after:  ${REALTIME.has(c.$id) ? '(unchanged)' : '[]'}`);
      console.log(`   rollback: --restore ${c.$id} '${JSON.stringify(c.$permissions)}'`);
    }
    console.log(`\n${n} collections with broad grants.`);
    console.log('Apply one at a time:  node src/scripts/lock_collection_permissions.cjs --apply <id>');
    return;
  }

  const before = await db.getCollection(DB, target);
  console.log(`${target} BEFORE: ${JSON.stringify(before.$permissions)}  documentSecurity=${before.documentSecurity}`);
  console.log(`ROLLBACK: restore permissions to ${JSON.stringify(before.$permissions)}\n`);

  if (REALTIME.has(target)) {
    console.error(`REFUSING: ${target} backs a realtime subscription. Removing its grants without a`);
    console.error('per-document permission backfill makes existing documents unreadable and stops');
    console.error('live scan progress. Do the backfill first.');
    process.exit(1);
  }

  await db.updateCollection(DB, target, before.name, [], before.documentSecurity, before.enabled);

  const after = await db.getCollection(DB, target);
  console.log(`${target} AFTER:  ${JSON.stringify(after.$permissions)}  documentSecurity=${after.documentSecurity}`);
  console.log(after.$permissions.length === 0 ? 'locked — server API key only' : 'UNEXPECTED: permissions not empty');
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
