// backend/src/scripts/migrate_gate_runs_collection.ts
//
// Provisions plan_gate_runs — the audit ledger of every compliance-gate
// evaluation (pass and block). `violations` is an off-row TEXT column (>=16384)
// holding the JSON array of blocking controls. Indexed by repoId (panel lookup)
// and createdAt (newest-first ordering).
//
// Run:
//   cd backend && npx ts-node src/scripts/migrate_gate_runs_collection.ts
//
// Idempotent: existing collection, attributes and indexes are skipped.
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

const COLLECTION = 'plan_gate_runs';
const ATTRIBUTES = [
  { key: 'repoId', size: 64, required: true },
  // Where the gate fired ('ci' | 'deploy') plus deploy-source context.
  { key: 'source', size: 16, required: false },
  { key: 'environment', size: 32, required: false },
  { key: 'actor', size: 128, required: false },
  { key: 'commitSha', size: 64, required: false },
  { key: 'branch', size: 255, required: false },
  { key: 'status', size: 16, required: true },
  // off-row TEXT: the violations JSON array can be large.
  { key: 'violations', size: 16384, required: false },
  { key: 'createdAt', size: 64, required: true },
];
const INDEXES = [
  { key: 'repoId_idx', attributes: ['repoId'] },
  { key: 'createdAt_idx', attributes: ['createdAt'] },
];

function already(raw: unknown): boolean {
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
}

async function waitForAttributes(keys: string[], timeoutMs = 90000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(keys);
  while (Date.now() < deadline) {
    const list = await databases.listAttributes(DB_ID, COLLECTION);
    const status = new Map(list.attributes.map((a) => [(a as { key: string }).key, (a as { status?: string }).status]));
    for (const key of [...pending]) {
      const s = status.get(key);
      if (s === 'available') pending.delete(key);
      else if (s === 'failed') { console.error(`  [ERR]  attribute "${key}" is 'failed'; delete and recreate`); pending.delete(key); }
    }
    if (pending.size === 0) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`  [WARN] attributes still not available after ${timeoutMs}ms: ${[...pending].join(', ')}`);
}

async function run(): Promise<void> {
  if (!DB_ID) { console.error('[FATAL] APPWRITE_DATABASE_ID is not set'); process.exit(1); }

  console.log(`\nEnsuring collection "${COLLECTION}"...`);
  try {
    await databases.createCollection(DB_ID, COLLECTION, 'Plan Gate Runs', [], false);
    console.log('  [OK]   collection created');
  } catch (raw) {
    if (already(raw)) console.log('  [SKIP] collection already exists');
    else { console.error(`  [ERR]  collection: ${(raw as Error).message}`); process.exit(1); }
  }

  await new Promise((r) => setTimeout(r, 1500));

  for (const a of ATTRIBUTES) {
    try {
      await databases.createStringAttribute(DB_ID, COLLECTION, a.key, a.size, a.required);
      console.log(`  [OK]   attribute "${a.key}"`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] attribute "${a.key}" already exists`);
      else console.error(`  [ERR]  attribute "${a.key}": ${(raw as Error).message}`);
    }
  }

  await waitForAttributes([...new Set(INDEXES.flatMap((i) => i.attributes))]);

  for (const idx of INDEXES) {
    try {
      await databases.createIndex(DB_ID, COLLECTION, idx.key, DatabasesIndexType.Key, idx.attributes);
      console.log(`  [OK]   index "${idx.key}"`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] index "${idx.key}" already exists`);
      else console.error(`  [ERR]  index "${idx.key}": ${(raw as Error).message}`);
    }
  }

  console.log('\nDone. plan_gate_runs is provisioned.');
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
