// backend/src/scripts/check_plan_collections.cjs
//
// Ground-truth status check for the Plan Workspace collections.
//
// The migration logs [OK]/[SKIP] on the *create request*, but Appwrite builds
// attributes and indexes asynchronously: the API accepts the call, then the
// attribute processes to 'available' or 'failed'. A create can be accepted and
// still end up unusable ('failed' / stuck 'processing'), which is exactly what
// the sprintId index error and the plan_comments.body "max reached" error hint
// at. This reads the real status so we stop trusting the creation logs.
//
// Run:
//   cd backend && node src/scripts/check_plan_collections.cjs
const { Client, Databases } = require('node-appwrite');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

const COLLECTIONS = [
  'plan_projects', 'plan_epics', 'plan_sprints', 'plan_issues', 'plan_comments',
  'plan_worklogs', 'plan_automation_rules', 'plan_automation_runs',
  'plan_sprint_snapshots', 'plan_threats',
];

// Expected attributes per collection (must match migrate_plan_collections.ts).
const EXPECTED = {
  plan_projects: ['name', 'repoId', 'type', 'createdAt', 'user_id'],
  plan_epics: ['projectId', 'title', 'color', 'startDate', 'endDate', 'status'],
  plan_sprints: ['projectId', 'name', 'goal', 'startDate', 'endDate', 'status'],
  plan_issues: ['projectId', 'epicId', 'sprintId', 'type', 'title', 'description',
    'priority', 'status', 'assignee', 'storyPoints', 'timeEstimate', 'timeLogged',
    'vulnId', 'labels', 'dueDate', 'createdAt'],
  plan_comments: ['issueId', 'author', 'body', 'createdAt'],
  plan_worklogs: ['issueId', 'author', 'minutes', 'comment', 'createdAt'],
  plan_automation_rules: ['projectId', 'trigger', 'conditions', 'action', 'enabled', 'runCount', 'lastRunAt'],
  plan_automation_runs: ['projectId', 'ruleId', 'trigger', 'action', 'status', 'message', 'issueId', 'createdAt'],
  plan_sprint_snapshots: ['projectId', 'sprintId', 'sprintName', 'committedPoints',
    'completedPoints', 'committedIssues', 'completedIssues', 'startDate', 'endDate', 'closedAt'],
  plan_threats: ['projectId', 'title', 'strideCategory', 'severity', 'description', 'mitigation', 'status', 'issueId'],
};

const EXPECTED_INDEXES = {
  plan_projects: ['user_id_idx', 'createdAt_idx'],
  plan_epics: ['projectId_idx'],
  plan_sprints: ['projectId_idx'],
  plan_issues: ['projectId_idx', 'sprintId_idx', 'epicId_idx'],
  plan_comments: ['issueId_idx'],
  plan_worklogs: ['issueId_idx'],
  plan_automation_rules: ['projectId_idx'],
  plan_automation_runs: ['projectId_idx', 'createdAt_idx'],
  plan_sprint_snapshots: ['projectId_idx', 'closedAt_idx'],
  plan_threats: ['projectId_idx'],
};

let problems = 0;

async function checkCollection(id) {
  console.log(`\n=== ${id} ===`);
  let attrs, idxs;
  try {
    attrs = await databases.listAttributes(DB_ID, id);
    idxs = await databases.listIndexes(DB_ID, id);
  } catch (e) {
    console.log(`  [FATAL] cannot read collection: ${e.message}`);
    problems++;
    return;
  }

  const byKey = new Map(attrs.attributes.map((a) => [a.key, a]));
  for (const key of EXPECTED[id]) {
    const a = byKey.get(key);
    if (!a) {
      console.log(`  [MISSING]   attribute "${key}"`);
      problems++;
    } else if (a.status !== 'available') {
      console.log(`  [${a.status.toUpperCase()}] attribute "${key}" (type=${a.type}${a.error ? `, error="${a.error}"` : ''})`);
      problems++;
    } else {
      console.log(`  [ok]        attribute "${key}"`);
    }
  }
  // Surface unexpected attributes too (e.g. a failed duplicate holding a slot).
  for (const a of attrs.attributes) {
    if (!EXPECTED[id].includes(a.key)) {
      console.log(`  [EXTRA]     attribute "${a.key}" (status=${a.status})`);
    }
  }

  const idxByKey = new Map(idxs.indexes.map((i) => [i.key, i]));
  for (const key of EXPECTED_INDEXES[id]) {
    const i = idxByKey.get(key);
    if (!i) {
      console.log(`  [MISSING]   index "${key}"`);
      problems++;
    } else if (i.status !== 'available') {
      console.log(`  [${i.status.toUpperCase()}] index "${key}"${i.error ? ` error="${i.error}"` : ''}`);
      problems++;
    } else {
      console.log(`  [ok]        index "${key}" -> [${i.attributes.join(', ')}]`);
    }
  }
}

async function run() {
  if (!DB_ID) { console.error('[FATAL] APPWRITE_DATABASE_ID not set'); process.exit(1); }
  for (const id of COLLECTIONS) await checkCollection(id);
  console.log(`\n${problems === 0 ? 'ALL GREEN — every attribute and index is available.' : `${problems} problem(s) found — see above.`}`);
  process.exit(problems === 0 ? 0 : 1);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
