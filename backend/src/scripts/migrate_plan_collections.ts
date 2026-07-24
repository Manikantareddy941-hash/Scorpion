// backend/src/scripts/migrate_plan_collections.ts
//
// Provisions every Plan Workspace collection planRepository writes to:
//   plan_projects (indexes only — already exists), plan_epics, plan_sprints,
//   plan_issues, plan_comments, plan_worklogs, plan_automation_rules,
//   plan_automation_runs, plan_sprint_snapshots, plan_threats.
// The first pass only covered epics/sprints/issues/comments; the rest (time
// tracking, automation, burndown snapshots, threat modeling) were still on the
// JSON fallback. Order-by queries (listProjects, listAutomationRuns,
// listSprintSnapshots) also need indexes on their sort attribute or the query
// throws and falls back — those indexes are included here.
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
  | { kind: 'integer'; key: string; required: boolean }
  | { kind: 'float'; key: string; required: boolean }
  | { kind: 'boolean'; key: string; required: boolean };

interface CollectionSpec {
  id: string;
  name: string;
  attributes: AttrKind[];
  indexes: { key: string; attributes: string[] }[];
}

// mitigation: description/body hold multi-line markdown; size them generously.
const COLLECTIONS: CollectionSpec[] = [
  {
    // plan_projects already exists, but listProjects filters user_id AND orders
    // by createdAt — Appwrite needs an index on both or the query throws and
    // projects fall back to JSON too. Attributes here are skipped if present;
    // the point is to add any missing index. (Idempotent by design.)
    id: 'plan_projects',
    name: 'Plan Projects',
    attributes: [
      { kind: 'string', key: 'name', size: 512, required: true },
      { kind: 'string', key: 'repoId', size: 128, required: false },
      { kind: 'string', key: 'type', size: 16, required: true },
      { kind: 'string', key: 'createdAt', size: 64, required: true },
      { kind: 'string', key: 'user_id', size: 64, required: false },
    ],
    indexes: [
      { key: 'user_id_idx', attributes: ['user_id'] },
      { key: 'createdAt_idx', attributes: ['createdAt'] },
    ],
  },
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
      // float, not integer: logWork writes timeLogged += minutes/60 (fractional
      // hours). An integer column rejects that and the worklog silently falls
      // back to JSON. timeEstimate is the same hours concept, so float too.
      { kind: 'float', key: 'timeEstimate', required: false },
      { kind: 'float', key: 'timeLogged', required: false },
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
  {
    id: 'plan_worklogs',
    name: 'Plan Worklogs',
    attributes: [
      { kind: 'string', key: 'issueId', size: 64, required: true },
      { kind: 'string', key: 'author', size: 256, required: true },
      { kind: 'integer', key: 'minutes', required: true },
      { kind: 'string', key: 'comment', size: 4096, required: false },
      { kind: 'string', key: 'createdAt', size: 64, required: true },
    ],
    indexes: [{ key: 'issueId_idx', attributes: ['issueId'] }],
  },
  {
    id: 'plan_automation_rules',
    name: 'Plan Automation Rules',
    attributes: [
      { kind: 'string', key: 'projectId', size: 64, required: true },
      { kind: 'string', key: 'trigger', size: 128, required: true },
      // 16384 so Appwrite stores these off-row (TEXT). At 8192 they are inline
      // VARCHAR and two of them overflow the ~64KB row limit — action failed.
      { kind: 'string', key: 'conditions', size: 16384, required: false },
      { kind: 'string', key: 'action', size: 16384, required: true },
      { kind: 'boolean', key: 'enabled', required: false },
      { kind: 'integer', key: 'runCount', required: false },
      { kind: 'string', key: 'lastRunAt', size: 64, required: false },
    ],
    indexes: [{ key: 'projectId_idx', attributes: ['projectId'] }],
  },
  {
    id: 'plan_automation_runs',
    name: 'Plan Automation Runs',
    attributes: [
      { kind: 'string', key: 'projectId', size: 64, required: true },
      { kind: 'string', key: 'ruleId', size: 64, required: true },
      { kind: 'string', key: 'trigger', size: 128, required: true },
      { kind: 'string', key: 'action', size: 8192, required: true },
      { kind: 'string', key: 'status', size: 16, required: true },
      { kind: 'string', key: 'message', size: 4096, required: true },
      { kind: 'string', key: 'issueId', size: 64, required: false },
      { kind: 'string', key: 'createdAt', size: 64, required: true },
    ],
    // listAutomationRuns filters projectId AND orders by createdAt.
    indexes: [
      { key: 'projectId_idx', attributes: ['projectId'] },
      { key: 'createdAt_idx', attributes: ['createdAt'] },
    ],
  },
  {
    id: 'plan_sprint_snapshots',
    name: 'Plan Sprint Snapshots',
    attributes: [
      { kind: 'string', key: 'projectId', size: 64, required: true },
      { kind: 'string', key: 'sprintId', size: 64, required: true },
      { kind: 'string', key: 'sprintName', size: 512, required: true },
      { kind: 'integer', key: 'committedPoints', required: true },
      { kind: 'integer', key: 'completedPoints', required: true },
      { kind: 'integer', key: 'committedIssues', required: true },
      { kind: 'integer', key: 'completedIssues', required: true },
      { kind: 'string', key: 'startDate', size: 64, required: false },
      { kind: 'string', key: 'endDate', size: 64, required: false },
      { kind: 'string', key: 'closedAt', size: 64, required: true },
    ],
    // listSprintSnapshots filters projectId AND orders by closedAt.
    indexes: [
      { key: 'projectId_idx', attributes: ['projectId'] },
      { key: 'closedAt_idx', attributes: ['closedAt'] },
    ],
  },
  {
    id: 'plan_threats',
    name: 'Plan Threats',
    attributes: [
      { kind: 'string', key: 'projectId', size: 64, required: true },
      { kind: 'string', key: 'title', size: 512, required: true },
      { kind: 'string', key: 'strideCategory', size: 64, required: true },
      { kind: 'string', key: 'severity', size: 16, required: true },
      // 16384 -> off-row TEXT; two inline 8192 strings overflow the row limit.
      { kind: 'string', key: 'description', size: 16384, required: false },
      { kind: 'string', key: 'mitigation', size: 16384, required: false },
      { kind: 'string', key: 'status', size: 32, required: true },
      { kind: 'string', key: 'issueId', size: 64, required: false },
    ],
    indexes: [{ key: 'projectId_idx', attributes: ['projectId'] }],
  },
];

function already(raw: unknown): boolean {
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
}

// Poll until every named attribute reports status 'available', or give up
// after timeoutMs. A 'failed' attribute is surfaced loudly since no amount of
// waiting fixes it. Returns having warned rather than throwing, so a single
// slow attribute never aborts the whole idempotent run.
async function waitForAttributes(
  collectionId: string,
  keys: string[],
  timeoutMs = 90000,
): Promise<void> {
  if (keys.length === 0) return;
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(keys);
  while (Date.now() < deadline) {
    const list = await databases.listAttributes(DB_ID, collectionId);
    const status = new Map(
      list.attributes.map((a) => [
        (a as { key: string }).key,
        (a as { status?: string }).status,
      ]),
    );
    for (const key of [...pending]) {
      const s = status.get(key);
      if (s === 'available') pending.delete(key);
      else if (s === 'failed') {
        console.error(`  [ERR]  attribute "${key}" is in 'failed' state; delete and recreate it`);
        pending.delete(key);
      }
    }
    if (pending.size === 0) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`  [WARN] attributes still not available after ${timeoutMs}ms: ${[...pending].join(', ')} — indexes on them may fail`);
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
      } else if (a.kind === 'integer') {
        await databases.createIntegerAttribute(DB_ID, spec.id, a.key, a.required);
      } else if (a.kind === 'float') {
        await databases.createFloatAttribute(DB_ID, spec.id, a.key, a.required);
      } else {
        await databases.createBooleanAttribute(DB_ID, spec.id, a.key, a.required);
      }
      console.log(`  [OK]   attribute "${a.key}"`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] attribute "${a.key}" already exists`);
      else console.error(`  [ERR]  attribute "${a.key}": ${(raw as Error).message}`);
    }
  }

  // Indexes require their attributes to be 'available'. Appwrite builds
  // attributes asynchronously and can take far longer than a fixed sleep under
  // load (sprintId sat in 'processing' for minutes), so poll real status
  // instead of guessing. Without this the index create races and fails.
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
  console.log('\nDone. All Plan Workspace collections are provisioned.');
  console.log('The Plan Workspace now persists to Appwrite instead of the local JSON fallback.');
  console.log('Run check_plan_collections.cjs to confirm every attribute and index is available.');
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
