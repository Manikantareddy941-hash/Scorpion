// backend/src/scripts/migrate_incidents_repo_id.ts
//
// Adds repo_id to the EXISTING `incidents` collection so a runtime (Falco)
// incident can be scoped to a project's bound repos — the Monitor->Plan
// feedback join read by securityRequirementsService.computeCorrelation and
// stamped at ingest by falcoHandler. Indexed for the repo_id lookup.
//
// Run:
//   cd backend && npx ts-node src/scripts/migrate_incidents_repo_id.ts
//
// Idempotent: an existing attribute or index is skipped. Does NOT create the
// collection (it already exists) — only augments it.
import { Client, Databases, DatabasesIndexType } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

const COLLECTION = 'incidents';
const ATTRIBUTE = { key: 'repo_id', size: 64, required: false };
const INDEX = { key: 'repo_id_idx', attributes: ['repo_id'] };

function already(raw: unknown): boolean {
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
}

async function waitForAttribute(key: string, timeoutMs = 90000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await databases.listAttributes(DB_ID, COLLECTION);
    const status = new Map(list.attributes.map((a) => [(a as { key: string }).key, (a as { status?: string }).status]));
    const s = status.get(key);
    if (s === 'available') return;
    if (s === 'failed') { console.error(`  [ERR]  attribute "${key}" is 'failed'; delete and recreate`); return; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`  [WARN] attribute "${key}" still not available after ${timeoutMs}ms`);
}

async function run(): Promise<void> {
  if (!DB_ID) { console.error('[FATAL] APPWRITE_DATABASE_ID is not set'); process.exit(1); }

  console.log(`\nAugmenting collection "${COLLECTION}" with repo_id...`);
  try {
    await databases.createStringAttribute(DB_ID, COLLECTION, ATTRIBUTE.key, ATTRIBUTE.size, ATTRIBUTE.required);
    console.log(`  [OK]   attribute "${ATTRIBUTE.key}"`);
  } catch (raw) {
    if (already(raw)) console.log(`  [SKIP] attribute "${ATTRIBUTE.key}" already exists`);
    else { console.error(`  [ERR]  attribute "${ATTRIBUTE.key}": ${(raw as Error).message}`); process.exit(1); }
  }

  await waitForAttribute(ATTRIBUTE.key);

  try {
    await databases.createIndex(DB_ID, COLLECTION, INDEX.key, DatabasesIndexType.Key, INDEX.attributes);
    console.log(`  [OK]   index "${INDEX.key}"`);
  } catch (raw) {
    if (already(raw)) console.log(`  [SKIP] index "${INDEX.key}" already exists`);
    else console.error(`  [ERR]  index "${INDEX.key}": ${(raw as Error).message}`);
  }

  console.log('\nDone. incidents.repo_id is provisioned.');
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
