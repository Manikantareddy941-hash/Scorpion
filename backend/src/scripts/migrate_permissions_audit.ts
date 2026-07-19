// backend/src/scripts/migrate_permissions_audit.ts
//
// Job 2 — Permissions Audit (the one that actually matters)
//
// Problem:
//   Appwrite collection permissions are separate from backend auth.
//   A user with a valid session can open devtools and call the Appwrite
//   SDK directly — the backend JWT middleware never runs.  If any
//   collection has Role.users() read, every customer can read every
//   document in it.
//
// Target state (post-migration):
//
//   scans, vulnerabilities, findings (= COLLECTIONS.VULNERABILITIES)
//     permissions    : []               — no collection-wide grants
//     documentSecurity: true            — realtime needs per-document read
//                                         for the owner's session to receive
//                                         events; document-level perms let the
//                                         backend grant read to exactly one user
//                                         when it creates/updates the document.
//
//   every other collection
//     permissions    : []               — no collection-wide grants
//     documentSecurity: false           — browser never reads these directly;
//                                         API key backend owns all access
//
// Browser legitimately needs Appwrite for:
//   account, storage (avatars), functions, realtime subscriptions
//
// It does NOT need direct DB read on:
//   repositories, notifications, integrations, chat_sessions, tasks,
//   reports, vulnerabilities (except via realtime), findings, scans
//   (except via realtime), and everything else.
//
// Verification (run as user A in devtools console after migration):
//
//   import('/src/lib/appwrite.ts').then(({ databases, DB_ID, COLLECTIONS }) => {
//     databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS)
//       .then(r  => console.error('FAIL — got list:', r))
//       .catch(e => console.log('OK — got 401:', e.code));
//   });
//
//   // Expect 401, not a list.
//
// Run:
//   cd backend && npx ts-node src/scripts/migrate_permissions_audit.ts
//
import { Client, Databases } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

// ─── policy map ──────────────────────────────────────────────────────────────
//
// Collections where documentSecurity must be ON:
//   Realtime events are only delivered to a session that can READ the document.
//   If documentSecurity=false, there is no per-doc grant to give — and realtime
//   silently stops delivering (or requires collection-wide read, which opens the
//   whole collection to every user).
//
//   scans          — ScanResults page subscribes to individual scan docs
//   vulnerabilities — Monitor / Alerts pages subscribe to findings
//   findings       — same collection (COLLECTIONS.FINDINGS = 'vulnerabilities')
//
// All other collections stay documentSecurity=false and permissions=[].
// The browser never reads them directly; the backend API key handles everything.

const REALTIME_COLLECTIONS = new Set([
  'scans',
  'vulnerabilities', // also serves as COLLECTIONS.FINDINGS
]);

// All collections that exist (or may exist) in the database.
// We do NOT skip unknown ones — the script fetches the live list and
// patches every collection it finds, so newly created ones are covered too.

async function run(): Promise<void> {
  if (!DB_ID) {
    console.error('[FATAL] APPWRITE_DATABASE_ID is not set');
    process.exit(1);
  }

  // 1. Fetch every collection in the database
  console.log(`\nFetching collections from database "${DB_ID}"...`);
  // Appwrite returns permissions as `$permissions`, not `permissions`. This
  // script read the wrong key, so every collection reported `undefined` and the
  // audit looked clean while 15 collections granted blanket access to any
  // authenticated user — one of them to `any`, unauthenticated. The cast to a
  // hand-written shape is what let the wrong name compile.
  let collections: { $id: string; name: string; $permissions: string[]; documentSecurity: boolean }[] = [];
  try {
    const response = await databases.listCollections(DB_ID);
    collections = response.collections;
    console.log(`  Found ${collections.length} collection(s).`);
  } catch (err: any) {
    console.error(`[FATAL] Could not list collections: ${err.message}`);
    process.exit(1);
  }

  if (collections.length === 0) {
    console.log('  No collections found — nothing to patch.');
    return;
  }

  // 2. For each collection, apply the correct permission model
  let patched = 0;
  let alreadyCorrect = 0;
  let errored = 0;

  for (const col of collections) {
    const needsDocSecurity = REALTIME_COLLECTIONS.has(col.$id);
    const targetPerms: string[] = [];
    const targetDocSec = needsDocSecurity;

    const currentPermsStr = JSON.stringify(col.$permissions?.slice().sort() ?? []);
    const targetPermsStr  = JSON.stringify(targetPerms);

    const alreadyOk =
      currentPermsStr === targetPermsStr &&
      col.documentSecurity === targetDocSec;

    if (alreadyOk) {
      console.log(`  [SKIP] ${col.$id.padEnd(32)} (${col.name}) — already correct`);
      alreadyCorrect++;
      continue;
    }

    const label = needsDocSecurity
      ? 'permissions=[], documentSecurity=true  (realtime)'
      : 'permissions=[], documentSecurity=false (backend-only)';

    try {
      await databases.updateCollection(
        DB_ID,
        col.$id,
        col.name,           // name unchanged
        targetPerms,        // permissions: []
        targetDocSec,       // documentSecurity
      );
      console.log(`  [OK]   ${col.$id.padEnd(32)} (${col.name}) — ${label}`);
      patched++;
    } catch (err: any) {
      console.error(`  [ERR]  ${col.$id} — ${err.message}`);
      errored++;
    }

    // Small delay to avoid hammering the Appwrite API
    await new Promise((r) => setTimeout(r, 300));
  }

  // 3. Summary
  console.log('\n─────────────────────────────────────────────────────');
  console.log(`  Patched         : ${patched}`);
  console.log(`  Already correct : ${alreadyCorrect}`);
  console.log(`  Errors          : ${errored}`);
  console.log('─────────────────────────────────────────────────────');

  if (errored > 0) {
    console.error('\n  Permissions audit completed with errors. Review output above.');
    process.exit(1);
  } else {
    console.log('\n  Permissions audit complete.\n');
  }
}

// ─── Verification reminder ────────────────────────────────────────────────────
//
// After running this script, open a browser as User A and paste into devtools:
//
// Step 1 — integrations must be completely blocked (401):
//
//   const { databases, DB_ID, COLLECTIONS } = await import('/src/lib/appwrite.ts');
//   await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS);
//   // Expect: AppwriteException code 401
//
// Step 2 — vulnerabilities must show ONLY User A's findings (not zero, not all):
//
//   const { databases, DB_ID, COLLECTIONS } = await import('/src/lib/appwrite.ts');
//   await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES);
//   // Expect: only documents where the backend granted User A document-level read
//
// Step 3 — repeat steps 1-2 as User B, confirm User B cannot see User A's findings.

run().catch((err) => {
  console.error('[FATAL]', err.message ?? err);
  process.exit(1);
});
