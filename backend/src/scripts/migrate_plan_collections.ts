// backend/src/scripts/migrate_plan_collections.ts
//
// Creates the Plan Workspace collections the code already expects but that do
// not exist in Appwrite: plan_epics, plan_sprints, plan_issues, plan_comments.
//
// Why this matters
// ----------------
// planRepository wraps every operation in handleQuery(appwriteCall, mockCall):
// it tries Appwrite and, on ANY error, silently falls back to a local JSON file
// (scratch/plan_mock_db.json). Because these four collections are missing, every
// epic/sprint/issue/comment read and write throws and lands in that JSON file -
// server-local, lost on redeploy, not shared across instances. plan_projects
// exists, so projects persist correctly while everything under them does not.
// The result looks like a working Plan Workspace whose child data quietly never
// reaches the database. Same shape as the reports collection gap.
//
// Attributes below are taken from planRepository's createDocument payloads and
// backend/src/types/plan.types.ts. Permissions are intentionally empty: the
// backend reaches these with the server API key, and planRepository already
// scopes reads by the owning project (and projects by user_id), so the browser
// never needs direct collection access.
//
// Run:
//   cd backend && npx ts-node src/scripts/migrate_plan_collections.ts
//
// Idempotent: existing collections, attributes and indexes are skipped.
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

type AttrKind =
  | { kind: 'string'; key: string; size: number; required: boolean; array?: boolean }
  | { kind: 'integer'; key: string; required: boolean };

interface CollectionSpec {
  id: string;
  name: string;
  attributes: AttrKind[];
  indexes: { key: string; attributes: string[] }[];
}

// mitigation: description/body hold multi-line markdown; size them generously.
const COLLECTIONS: CollectionSpec[] = [
  {
    id: 'plan_epics',
    name: 'Plan Epics',
    attributes: [
      { kind: 'string', key: 'projectId', size: 64, required: true },
      { kind: 'string', key: 'title', size: 512, required: true },
      { kind: 'string', key: 'color', size: 16, required: false },
      { kind: 'string', key: 'startDate', size: 64, required: false },
      { kind: 'string', key: 'endDate', size: 64, required: false },
      { kind: 'string', key: 'status', size: 32, required: true },
    ],
    indexes: [{ key: 'projectId_idx', attributes: ['projectId'] }],
  },
  {
    id: 'plan_sprints',
    name: 'Plan Sprints',
    attributes: [
      { kind: 'string', key: 'projectId', size: 64, required: true },
      { kind: 'string', key: 'name', size: 512, required: true },
      { kind: 'string', key: 'goal', size: 2048, required: false },
      { kind: 'string', key: 'startDate', size: 64, required: false },
      { kind: 'string', key: 'endDate', size: 64, required: false },
      { kind: 'string', key: 'status', size: 32, required: true },
    ],
    indexes: [{ key: 'projectId_idx', attributes: ['projectId'] }],
  },
  {
    id: 'plan_issues',
    name: 'Plan Issues',
    attributes: [
      { kind: 'string', key: 'projectId', size: 64, required: true },
      { kind: 'string', key: 'epicId', size: 64, required: false },
      { kind: 'string', key: 'sprintId', size: 64, required: false },
      { kind: 'string', key: 'type', size: 32, required: true },
      { kind: 'string', key: 'title', size: 1024, required: true },
      { kind: 'string', key: 'description', size: 16384, required: false },
      { kind: 'string', key: 'priority', size: 16, required: true },
      { kind: 'string', key: 'status', size: 32, required: true },
      { kind: 'string', key: 'assignee', size: 256, required: false },
      { kind: 'integer', key: 'storyPoints', required: false },
      { kind: 'integer', key: 'timeEstimate', required: false },
      { kind: 'integer', key: 'timeLogged', required: false },
      { kind: 'string', key: 'vulnId', size: 64, required: false },
      { kind: 'string', key: 'labels', size: 128, required: false, array: true },
      { kind: 'string', key: 'dueDate', size: 64, required: false },
      { kind: 'string', key: 'createdAt', size: 64, required: true },
    ],
    indexes: [
      { key: 'projectId_idx', attributes: ['projectId'] },
      { key: 'sprintId_idx', attributes: ['sprintId'] },
      { key: 'epicId_idx', attributes: ['epicId'] },
    ],
  },
  {
    id: 'plan_comments',
    name: 'Plan Comments',
    attributes: [
      { kind: 'string', key: 'issueId', size: 64, required: true },
      { kind: 'string', key: 'author', size: 256, required: true },
      { kind: 'string', key: 'body', size: 8192, required: true },
      { kind: 'string', key: 'createdAt', size: 64, required: true },
    ],
    indexes: [{ key: 'issueId_idx', attributes: ['issueId'] }],
  },
];

function already(raw: unknown): boolean {
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
}

async function ensureCollection(spec: CollectionSpec): Promise<void> {
  console.log(`\nEnsuring collection "${spec.id}"...`);
  try {
    // Empty permissions, documentSecurity off: backend API key owns all access.
    await databases.createCollection(DB_ID, spec.id, spec.name, [], false);
    console.log(`  [OK]   collection created`);
  } catch (raw) {
    if (already(raw)) console.log(`  [SKIP] collection already exists`);
    else { console.error(`  [ERR]  collection: ${(raw as Error).message}`); process.exit(1); }
  }

  // Appwrite needs a beat after collection creation before attributes attach.
  await new Promise((r) => setTimeout(r, 1500));

  for (const a of spec.attributes) {
    try {
      if (a.kind === 'string') {
        await databases.createStringAttribute(DB_ID, spec.id, a.key, a.size, a.required, undefined, a.array ?? false);
      } else {
        await databases.createIntegerAttribute(DB_ID, spec.id, a.key, a.required);
      }
      console.log(`  [OK]   attribute "${a.key}"`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] attribute "${a.key}" already exists`);
      else console.error(`  [ERR]  attribute "${a.key}": ${(raw as Error).message}`);
    }
  }

  // Indexes require their attributes to be 'available'; wait for them.
  await new Promise((r) => setTimeout(r, 2500));

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
  console.log('\nDone. plan_epics, plan_sprints, plan_issues, plan_comments are provisioned.');
  console.log('The Plan Workspace now persists to Appwrite instead of the local JSON fallback.');
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
