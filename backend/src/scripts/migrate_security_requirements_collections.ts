// backend/src/scripts/migrate_security_requirements_collections.ts
//
// Provisions the two Appwrite collections for the Security Requirements Engine
// (Plan-phase feature 2a):
//   - plan_project_profiles      (one profile per project)
//   - plan_security_requirements (generated requirements + lifecycle/audit)
//
// Reuses the lessons proven in #125: strings >= 16384 are stored off-row (TEXT)
// so two large strings don't overflow the ~64KB row; attribute availability is
// polled before indexes are built, since Appwrite builds attributes async and a
// fixed sleep races. String-array attributes (frameworks, controlIds,
// sourceRuleId, stack, dataTypes) are created with the array flag and are
// optional (Appwrite array attributes can't be required).
//
// Run:
//   cd backend && npx ts-node src/scripts/migrate_security_requirements_collections.ts
//
// Idempotent: existing collections, attributes and indexes are skipped.
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

interface Attr { key: string; size: number; required: boolean; array?: boolean }
interface CollectionSpec { id: string; name: string; attributes: Attr[]; indexes: { key: string; attributes: string[] }[] }

const COLLECTIONS: CollectionSpec[] = [
  {
    id: 'plan_project_profiles',
    name: 'Plan Project Profiles',
    attributes: [
      { key: 'projectId', size: 64, required: true },
      { key: 'appType', size: 32, required: true },
      { key: 'stack', size: 32, required: false, array: true },
      { key: 'dataTypes', size: 16, required: false, array: true },
      { key: 'deployment', size: 32, required: true },
      { key: 'authModel', size: 32, required: true },
      { key: 'frameworks', size: 32, required: false, array: true },
      { key: 'updatedAt', size: 64, required: true },
    ],
    indexes: [{ key: 'projectId_idx', attributes: ['projectId'] }],
  },
  {
    id: 'plan_security_requirements',
    name: 'Plan Security Requirements',
    attributes: [
      { key: 'projectId', size: 64, required: true },
      { key: 'code', size: 128, required: true },
      { key: 'title', size: 512, required: true },
      // off-row TEXT: description can hold multi-sentence guidance.
      { key: 'description', size: 16384, required: false },
      { key: 'category', size: 64, required: false },
      { key: 'frameworks', size: 32, required: false, array: true },
      { key: 'controlIds', size: 64, required: false, array: true },
      { key: 'severity', size: 16, required: true },
      { key: 'status', size: 16, required: true },
      { key: 'lifecycleStatus', size: 16, required: true },
      { key: 'justification', size: 4096, required: false },
      { key: 'updatedBy', size: 64, required: false },
      { key: 'sourceRuleId', size: 64, required: false, array: true },
      { key: 'remediation', size: 16384, required: false },
      { key: 'createdAt', size: 64, required: true },
      // 3a: set once the requirement has been pushed to a sprint ticket.
      { key: 'ticketId', size: 64, required: false },
      { key: 'jiraKey', size: 64, required: false },
    ],
    indexes: [{ key: 'projectId_idx', attributes: ['projectId'] }],
  },
];

function already(raw: unknown): boolean {
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
}

async function waitForAttributes(collectionId: string, keys: string[], timeoutMs = 90000): Promise<void> {
  if (keys.length === 0) return;
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(keys);
  while (Date.now() < deadline) {
    const list = await databases.listAttributes(DB_ID, collectionId);
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

async function ensureCollection(spec: CollectionSpec): Promise<void> {
  console.log(`\nEnsuring collection "${spec.id}"...`);
  try {
    await databases.createCollection(DB_ID, spec.id, spec.name, [], false);
    console.log('  [OK]   collection created');
  } catch (raw) {
    if (already(raw)) console.log('  [SKIP] collection already exists');
    else { console.error(`  [ERR]  collection: ${(raw as Error).message}`); process.exit(1); }
  }

  await new Promise((r) => setTimeout(r, 1500));

  for (const a of spec.attributes) {
    try {
      await databases.createStringAttribute(DB_ID, spec.id, a.key, a.size, a.required, undefined, a.array ?? false);
      console.log(`  [OK]   attribute "${a.key}"`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] attribute "${a.key}" already exists`);
      else console.error(`  [ERR]  attribute "${a.key}": ${(raw as Error).message}`);
    }
  }

  const indexedKeys = [...new Set(spec.indexes.flatMap((i) => i.attributes))];
  await waitForAttributes(spec.id, indexedKeys);

  for (const idx of spec.indexes) {
    try {
      await databases.createIndex(DB_ID, spec.id, idx.key, DatabasesIndexType.Key, idx.attributes);
      console.log(`  [OK]   index "${idx.key}"`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] index "${idx.key}" already exists`);
      else console.error(`  [ERR]  index "${idx.key}": ${(raw as Error).message}`);
    }
  }
}

async function run(): Promise<void> {
  if (!DB_ID) { console.error('[FATAL] APPWRITE_DATABASE_ID is not set'); process.exit(1); }
  for (const spec of COLLECTIONS) await ensureCollection(spec);
  console.log('\nDone. plan_project_profiles and plan_security_requirements are provisioned.');
  console.log('Verify with a WRITE probe (list-probe misses phantom attributes).');
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
