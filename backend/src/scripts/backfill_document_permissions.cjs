/**
 * Per-document permission backfill for the realtime collections.
 *
 * The browser's realtime subscriptions only receive an event for a document the
 * session can read. So `scans` and `vulnerabilities` cannot simply have their
 * collection grants cleared the way the other 12 did - each document needs a
 * read permission naming its owner first, or live scan progress goes dead.
 *
 * Ownership is resolved through the document's repo_id -> repository, using the
 * repository's team_id when it has one and its user_id otherwise. That mirrors
 * how the API scopes these same rows (resolveOwnershipScope in tenancyService).
 *
 * Documents whose repo_id points at a repository that no longer exists get no
 * permission and stay invisible to the browser. They are already invisible
 * through the API, which filters by the caller's accessible repo ids - so this
 * removes a direct-access path to orphaned rows rather than hiding live data.
 * Nothing is deleted here.
 *
 * Order matters. While documentSecurity is false the per-document permissions
 * written by --backfill are ignored, so the backfill is a no-op in behaviour
 * until --seal flips documentSecurity on and clears the collection grants in
 * the same update. Backfill first, verify, then seal.
 *
 * Usage:
 *   node src/scripts/backfill_document_permissions.cjs                    # dry run
 *   node src/scripts/backfill_document_permissions.cjs --backfill <id>    # write per-doc perms
 *   node src/scripts/backfill_document_permissions.cjs --seal <id>        # documentSecurity on + clear grants
 */
const sdk = require('node-appwrite');
require('dotenv').config({ path: '.env' });

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new sdk.Databases(client);
const DB = process.env.APPWRITE_DATABASE_ID;

const TARGETS = ['scans', 'vulnerabilities'];

async function loadOwners() {
  const owners = new Map();
  let cursor = null;
  for (;;) {
    const q = [sdk.Query.limit(100)];
    if (cursor) q.push(sdk.Query.cursorAfter(cursor));
    const res = await db.listDocuments(DB, 'repositories', q);
    for (const r of res.documents) {
      owners.set(r.$id, r.team_id ? { type: 'team', id: r.team_id } : r.user_id ? { type: 'user', id: r.user_id } : null);
    }
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return owners;
}

async function* allDocs(collectionId) {
  let cursor = null;
  for (;;) {
    const q = [sdk.Query.limit(100)];
    if (cursor) q.push(sdk.Query.cursorAfter(cursor));
    const res = await db.listDocuments(DB, collectionId, q);
    for (const d of res.documents) yield d;
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
}

const permsFor = (owner) => [
  owner.type === 'team' ? sdk.Permission.read(sdk.Role.team(owner.id)) : sdk.Permission.read(sdk.Role.user(owner.id)),
];

async function run(collectionId, write) {
  const owners = await loadOwners();
  let owned = 0, orphaned = 0, noRepo = 0, written = 0, failed = 0;

  for await (const doc of allDocs(collectionId)) {
    if (!doc.repo_id) { noRepo++; continue; }
    const owner = owners.get(doc.repo_id);
    if (!owner) { orphaned++; continue; }
    owned++;
    if (!write) continue;
    try {
      await db.updateDocument(DB, collectionId, doc.$id, undefined, permsFor(owner));
      written++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.log(`   write failed ${doc.$id}: ${e.message}`);
    }
  }

  console.log(`${collectionId}: owner-resolvable=${owned}  orphaned=${orphaned}  no repo_id=${noRepo}`);
  if (write) console.log(`   permissions written=${written}  failed=${failed}`);
  return { owned, orphaned, noRepo };
}

async function seal(collectionId) {
  const before = await db.getCollection(DB, collectionId);
  console.log(`${collectionId} BEFORE: perms=${JSON.stringify(before.$permissions)} documentSecurity=${before.documentSecurity}`);
  console.log(`ROLLBACK: restore perms ${JSON.stringify(before.$permissions)}, documentSecurity=${before.documentSecurity}\n`);

  await db.updateCollection(DB, collectionId, before.name, [], true, before.enabled);

  const after = await db.getCollection(DB, collectionId);
  console.log(`${collectionId} AFTER:  perms=${JSON.stringify(after.$permissions)} documentSecurity=${after.documentSecurity}`);
}

(async () => {
  const argv = process.argv;
  const pick = (flag) => { const i = argv.indexOf(flag); return i > -1 ? argv[i + 1] : null; };
  const backfill = pick('--backfill');
  const toSeal = pick('--seal');

  if (backfill) {
    if (!TARGETS.includes(backfill)) { console.error(`--backfill expects one of: ${TARGETS.join(', ')}`); process.exit(1); }
    await run(backfill, true);
    console.log('\nPer-document permissions are ignored until --seal sets documentSecurity=true.');
    return;
  }

  if (toSeal) {
    if (!TARGETS.includes(toSeal)) { console.error(`--seal expects one of: ${TARGETS.join(', ')}`); process.exit(1); }
    await seal(toSeal);
    return;
  }

  console.log('DRY RUN — nothing will be changed.\n');
  for (const t of TARGETS) await run(t, false);
  console.log('\nBackfill:  node src/scripts/backfill_document_permissions.cjs --backfill <id>');
  console.log('Then seal: node src/scripts/backfill_document_permissions.cjs --seal <id>');
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
