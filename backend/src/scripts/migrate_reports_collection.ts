// backend/src/scripts/migrate_reports_collection.ts
//
// Job 1 — Create the `reports` collection
//
// Schema (from backend/src/routes/reportRoutes.ts):
//   userId       String  64      required
//   title        String  512     required
//   type         String  32      required
//   repositoryId String  64      optional
//   status       String  32      required
//   createdAt    String  64      required
//   data         String  65536   optional
//
// Index:
//   idx_user_id  key on userId   (supports Query.equal('userId', …) in GET /api/reports/history)
//   Sorting uses built-in $createdAt — no extra index needed.
//
// Permissions:
//   [] — deliberately empty.  The backend runs with an API key which
//   bypasses collection permissions, so no authenticated browser session
//   needs (or should have) direct collection access.
//
// Run:
//   cd backend && npx ts-node src/scripts/migrate_reports_collection.ts
//
import { Client, Databases, DatabasesIndexType } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';
const COLLECTION_ID = 'reports';
const COLLECTION_NAME = 'Reports';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function ensureString(
  colId: string,
  key: string,
  size: number,
  required: boolean,
): Promise<void> {
  try {
    await databases.createStringAttribute(DB_ID, colId, key, size, required);
    console.log(`  [OK]   attribute "${key}" created`);
  } catch (raw) {
    const err = raw as { code?: number; type?: string; message?: string };
    if (err.code === 409 || err.type?.includes('already_exists')) {
      console.log(`  [SKIP] attribute "${key}" already exists`);
    } else {
      console.error(`  [ERR]  attribute "${key}": ${err.message}`);
    }
  }
}

async function ensureIndex(
  colId: string,
  key: string,
  attributes: string[],
): Promise<void> {
  try {
    await databases.createIndex(DB_ID, colId, key, DatabasesIndexType.Key, attributes);
    console.log(`  [OK]   index "${key}" created`);
  } catch (raw) {
    const err = raw as { code?: number; type?: string; message?: string };
    if (err.code === 409 || err.type?.includes('already_exists')) {
      console.log(`  [SKIP] index "${key}" already exists`);
    } else {
      console.error(`  [ERR]  index "${key}": ${err.message}`);
    }
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  if (!DB_ID) {
    console.error('[FATAL] APPWRITE_DATABASE_ID is not set');
    process.exit(1);
  }

  // 1. Create collection (empty permissions → browser cannot touch it directly)
  console.log(`\nEnsuring collection "${COLLECTION_ID}"...`);
  try {
    await databases.createCollection(
      DB_ID,
      COLLECTION_ID,
      COLLECTION_NAME,
      [],      // permissions — intentionally empty
      false,   // documentSecurity — not needed; backend API key owns all access
    );
    console.log(`  [OK]   collection "${COLLECTION_ID}" created`);
  } catch (raw) {
    const err = raw as { code?: number; type?: string; message?: string };
    if (err.code === 409 || err.type?.includes('already_exists')) {
      console.log(`  [SKIP] collection "${COLLECTION_ID}" already exists`);
    } else {
      console.error(`  [ERR]  collection: ${err.message}`);
      process.exit(1);
    }
  }

  // Appwrite needs a moment after collection creation before attributes can be added
  await new Promise((r) => setTimeout(r, 1500));

  // 2. Attributes
  console.log('\nCreating attributes...');
  await ensureString(COLLECTION_ID, 'userId',       64,    true);
  await ensureString(COLLECTION_ID, 'title',        512,   true);
  await ensureString(COLLECTION_ID, 'type',         32,    true);
  await ensureString(COLLECTION_ID, 'repositoryId', 64,    false);
  await ensureString(COLLECTION_ID, 'status',       32,    true);
  await ensureString(COLLECTION_ID, 'createdAt',    64,    true);
  await ensureString(COLLECTION_ID, 'data',         65536, false);

  // Appwrite requires attributes to finish building before indexes can reference them
  console.log('\nWaiting for attributes to be ready (5 s)...');
  await new Promise((r) => setTimeout(r, 5000));

  // 3. Index — powers Query.equal('userId', ...) in GET /api/reports/history
  console.log('\nCreating indexes...');
  await ensureIndex(COLLECTION_ID, 'idx_user_id', ['userId']);

  console.log('\n  reports collection migration complete.\n');
}

run().catch((err) => {
  console.error('[FATAL]', err.message ?? err);
  process.exit(1);
});
