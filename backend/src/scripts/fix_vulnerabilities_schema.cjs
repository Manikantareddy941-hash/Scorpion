/**
 * Makes runId, source and title optional on the `vulnerabilities` collection.
 *
 * Why this is the right change rather than backfilling values into the rows:
 * nothing in the codebase writes these three attributes. The scan ingest
 * (backend/src/services/scanService.ts) writes repo_id, tool, severity,
 * message, file_path, line_number, status, fingerprint and friends - never
 * runId, source or title. So the schema does not describe what the application
 * actually produces, and marking them required made every write invalid.
 *
 * Two consequences, both fixed by this:
 *
 *  1. Ingestion. createDocument validates required attributes, so every
 *     finding write has been rejected. The newest document in the collection
 *     is dated 2026-05-14 - nothing has been stored since. Delta ingestion
 *     catches and logs the failure rather than surfacing it, so scans appeared
 *     to succeed while storing nothing.
 *
 *  2. The permission backfill. Appwrite validates the whole document on any
 *     update, so even a permissions-only write was rejected with
 *     'Missing required attribute "runId"'.
 *
 * Sizes and types are preserved exactly; only the required flag changes, with
 * a null default (which is what an optional attribute with no default means).
 *
 * Usage:
 *   node src/scripts/fix_vulnerabilities_schema.cjs           # dry run
 *   node src/scripts/fix_vulnerabilities_schema.cjs --apply
 */
const sdk = require('node-appwrite');
require('dotenv').config({ path: '.env' });

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new sdk.Databases(client);
const DB = process.env.APPWRITE_DATABASE_ID;
const COLLECTION = 'vulnerabilities';

// key -> size, taken from the live collection. Only `required` changes.
const RELAX = [
  { key: 'runId', size: 255 },
  { key: 'source', size: 50 },
  { key: 'title', size: 255 },
];

(async () => {
  const apply = process.argv.includes('--apply');
  const col = await db.getCollection(DB, COLLECTION);
  const byKey = new Map(col.attributes.map((a) => [a.key, a]));

  console.log(apply ? 'APPLYING\n' : 'DRY RUN — nothing will be changed.\n');

  for (const { key, size } of RELAX) {
    const a = byKey.get(key);
    if (!a) { console.log(`${key}: not present, skipping`); continue; }
    if (!a.required) { console.log(`${key}: already optional, skipping`); continue; }

    console.log(`${key}: required=true -> required=false  (string, size=${size}, default=null)`);
    console.log(`   ROLLBACK: updateStringAttribute(db, '${COLLECTION}', '${key}', true, null, ${size})`);

    if (apply) {
      // (databaseId, collectionId, key, required, default, size)
      await db.updateStringAttribute(DB, COLLECTION, key, false, null, size);
      console.log(`   applied`);
    }
  }

  if (!apply) {
    console.log('\nRun with --apply, then:');
    console.log('  node src/scripts/backfill_document_permissions.cjs --backfill vulnerabilities');
    return;
  }

  // Attribute updates are asynchronous in Appwrite; wait for them to settle.
  console.log('\nwaiting for attributes to become available...');
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const now = await db.getCollection(DB, COLLECTION);
    const pending = now.attributes.filter(
      (a) => RELAX.some((r) => r.key === a.key) && a.status !== 'available',
    );
    if (!pending.length) break;
  }

  const after = await db.getCollection(DB, COLLECTION);
  for (const { key } of RELAX) {
    const a = after.attributes.find((x) => x.key === key);
    console.log(`${key}: required=${a.required} status=${a.status}`);
  }
  console.log('\nNext: node src/scripts/backfill_document_permissions.cjs --backfill vulnerabilities');
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
