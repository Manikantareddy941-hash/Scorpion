// backend/src/scripts/import_plan_fallback.ts
//
// Moves Plan data out of the local JSON fallback (scratch/plan_mock_db.json)
// and into Appwrite, with an explicit owner, then stamps RBAC grants.
//
// Why it exists: planRepository falls back to a server-local JSON file on any
// Appwrite error, so the workspace looks like it works while its data never
// reaches the database — lost on redeploy, invisible to other instances, and
// invisible to authorization. Until this data is in Appwrite with an owner,
// RBAC shadow mode reports 100% divergence, which is noise rather than signal.
//
// Ownership is required, not inferred. The fallback records predate the tenancy
// model and carry no user_id or team_id; importing them as-is would create
// projects nobody owns, which receive no grant and become unreachable the
// moment enforcement turns on. So the owner is an argument and the script
// refuses to run without it.
//
// Grants are written by the SAME backfillGrants() the migration uses, not a
// copy of it. It is idempotent through the unique index, so it is safe to call
// here and again later.
//
// Run (from backend/, after migrate_rbac_collections):
//   node dist/backend/src/scripts/import_plan_fallback.js --user <user_id>
//     ...previews the import and writes nothing.
//   node dist/backend/src/scripts/import_plan_fallback.js --user <id> --apply
//     ...with optional --team <team_id>, --file <path>, --force
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { fetchAllDocuments } from '../lib/paginate';
import { backfillGrants } from '../authz/backfill';

const REQUIRED_ENV = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const ownerUserId = arg('user');
const ownerTeamId = arg('team');
const apply = flag('apply');
const force = flag('force');
const sourceFile = arg('file') ?? path.resolve(process.cwd(), 'scratch', 'plan_mock_db.json');

if (!ownerUserId) {
  console.error('[FATAL] --user <user_id> is required. Data imported without an owner receives no');
  console.error('        grant and is unreachable once RBAC enforcement is enabled.');
  process.exit(1);
}

type Record_ = { $id: string } & Record<string, unknown>;
type MockDb = Record<string, Record_[]>;

interface Plan {
  /** Key in the JSON file. */
  source: string;
  collectionId: string;
  /** Attributes that exist on the collection. Anything else is dropped — Appwrite rejects unknown keys. */
  fields: string[];
  required: string[];
  /** Foreign keys, remapped from source ids to the ids Appwrite assigns. */
  refs: { field: string; from: string }[];
}

// Order is load-bearing: a child cannot be remapped before its parent exists.
const PLANS: Plan[] = [
  {
    source: 'projects', collectionId: 'plan_projects',
    fields: ['name', 'repoId', 'type', 'createdAt', 'user_id', 'team_id'],
    required: ['name', 'type', 'createdAt'], refs: [],
  },
  {
    source: 'epics', collectionId: 'plan_epics',
    fields: ['projectId', 'title', 'color', 'startDate', 'endDate', 'status', 'cveId'],
    required: ['projectId', 'title', 'status'], refs: [{ field: 'projectId', from: 'projects' }],
  },
  {
    source: 'sprints', collectionId: 'plan_sprints',
    fields: ['projectId', 'name', 'goal', 'startDate', 'endDate', 'status'],
    required: ['projectId', 'name', 'status'], refs: [{ field: 'projectId', from: 'projects' }],
  },
  {
    source: 'issues', collectionId: 'plan_issues',
    fields: ['projectId', 'epicId', 'sprintId', 'type', 'title', 'description', 'priority', 'status',
      'assignee', 'storyPoints', 'timeEstimate', 'timeLogged', 'vulnId', 'labels', 'dueDate', 'createdAt'],
    required: ['projectId', 'type', 'title', 'priority', 'status', 'createdAt'],
    refs: [
      { field: 'projectId', from: 'projects' },
      { field: 'epicId', from: 'epics' },
      { field: 'sprintId', from: 'sprints' },
    ],
  },
  {
    source: 'comments', collectionId: 'plan_comments',
    fields: ['issueId', 'author', 'body', 'createdAt'],
    required: ['issueId', 'author', 'body', 'createdAt'], refs: [{ field: 'issueId', from: 'issues' }],
  },
  {
    source: 'worklogs', collectionId: 'plan_worklogs',
    fields: ['issueId', 'author', 'minutes', 'comment', 'createdAt'],
    required: ['issueId', 'author', 'minutes', 'createdAt'], refs: [{ field: 'issueId', from: 'issues' }],
  },
  {
    source: 'automationRules', collectionId: 'plan_automation_rules',
    fields: ['projectId', 'trigger', 'conditions', 'action', 'enabled', 'runCount', 'lastRunAt'],
    required: ['projectId', 'trigger', 'action'], refs: [{ field: 'projectId', from: 'projects' }],
  },
  {
    source: 'threats', collectionId: 'plan_threats',
    fields: ['projectId', 'title', 'strideCategory', 'severity', 'description', 'mitigation', 'status', 'issueId'],
    required: ['projectId', 'title', 'strideCategory', 'severity', 'status'],
    refs: [{ field: 'projectId', from: 'projects' }, { field: 'issueId', from: 'issues' }],
  },
];

/**
 * Rejects the whole import if any record is unusable. Half an import is worse
 * than none: the orphaned remainder is invisible until someone opens the board
 * and finds an epic with no issues under it.
 */
function preflight(db: MockDb): string[] {
  const problems: string[] = [];
  const idsBySource = new Map(PLANS.map((p) => [p.source, new Set((db[p.source] ?? []).map((r) => r.$id))]));

  for (const plan of PLANS) {
    for (const record of db[plan.source] ?? []) {
      for (const key of plan.required) {
        // user_id/team_id are stamped by this script, not present in the source.
        if (key === 'projectId' || key === 'issueId' || plan.fields.includes(key)) {
          if (record[key] === undefined || record[key] === null || record[key] === '') {
            problems.push(`${plan.source}/${record.$id}: missing required "${key}"`);
          }
        }
      }
      for (const ref of plan.refs) {
        const value = record[ref.field];
        if (value === undefined || value === null || value === '') continue; // optional link
        if (!idsBySource.get(ref.from)?.has(String(value))) {
          problems.push(`${plan.source}/${record.$id}: ${ref.field}="${String(value)}" has no matching ${ref.from}`);
        }
      }
    }
  }
  return problems;
}

/** Refuse to import on top of an earlier run unless explicitly told to. */
async function assertNotAlreadyImported(db: MockDb): Promise<void> {
  const existing = await fetchAllDocuments('plan_projects', [Query.equal('user_id', ownerUserId as string)]);
  if (existing.truncated) {
    console.error('[FATAL] could not read existing projects to completion — cannot rule out a double import');
    process.exit(1);
  }
  const names = new Set(existing.items.map((d) => (d as unknown as { name?: string }).name));
  const clashes = (db.projects ?? []).map((p) => String(p.name)).filter((n) => names.has(n));
  if (clashes.length > 0 && !force) {
    console.error(`[FATAL] this user already owns project(s) with the same name: ${clashes.join(', ')}`);
    console.error('        re-running would duplicate the board. Pass --force if that is genuinely intended.');
    process.exit(1);
  }
}

function payloadFor(plan: Plan, record: Record_, idMap: Map<string, Map<string, string>>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of plan.fields) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    const ref = plan.refs.find((r) => r.field === field);
    payload[field] = ref ? idMap.get(ref.from)?.get(String(value)) : value;
  }
  if (plan.source === 'projects') {
    // Ownership comes from the arguments, never from the file.
    payload.user_id = ownerUserId;
    if (ownerTeamId) payload.team_id = ownerTeamId;
  }
  return payload;
}

async function main(): Promise<void> {
  if (!fs.existsSync(sourceFile)) {
    console.error(`[FATAL] no such file: ${sourceFile}`);
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) as MockDb;

  console.log(`Source : ${sourceFile}`);
  console.log(`Owner  : user=${ownerUserId}${ownerTeamId ? ` team=${ownerTeamId}` : ' (no team)'}`);
  console.log(`Mode   : ${apply ? 'APPLY — writing to the live database' : 'DRY RUN — nothing will be written'}\n`);

  const problems = preflight(db);
  if (problems.length > 0) {
    console.error(`[FATAL] ${problems.length} problem(s); nothing imported:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log('Preflight: every required field present and every reference resolves.\n');

  if (apply) await assertNotAlreadyImported(db);

  const idMap = new Map<string, Map<string, string>>();
  for (const plan of PLANS) {
    const records = db[plan.source] ?? [];
    const mapped = new Map<string, string>();
    idMap.set(plan.source, mapped);
    if (records.length === 0) continue;

    for (const record of records) {
      if (!apply) { mapped.set(record.$id, `dry-${record.$id}`); continue; }
      const created = await databases.createDocument(
        DB_ID, plan.collectionId, ID.unique(), payloadFor(plan, record, idMap),
      );
      mapped.set(record.$id, created.$id);
    }
    console.log(`  ${apply ? 'imported' : 'would import'} ${records.length.toString().padStart(3)} -> ${plan.collectionId}`);
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to write, then grants are stamped automatically.');
    return;
  }

  console.log('\nStamping RBAC grants...');
  const tally = await backfillGrants();
  console.log(`  projects: ${tally.projects}   grants written: ${tally.granted}   already present: ${tally.existing}`);
  if (tally.unowned.length > 0) {
    console.error(`  [WARN] ${tally.unowned.length} project(s) still have no owner: ${tally.unowned.join(', ')}`);
  }

  console.log('\nDone. Verify with verify_rbac_backfill, then watch for rbac_divergence in the logs.');
  console.log(`The fallback file is untouched — delete ${sourceFile} once you have confirmed the board reads correctly.`);
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
