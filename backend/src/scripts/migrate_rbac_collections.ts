// backend/src/scripts/migrate_rbac_collections.ts
//
// Provisions fine-grained RBAC for the Plan workspace, then backfills grants so
// the switch to deny-by-default locks nobody out.
//
//   1. project_policies  role -> permission list (built-in roles only in v1)
//   2. project_access    (project, subject) -> role
//   3. seed              project_admin / project_editor / project_viewer
//   4. backfill          two grants per project, BOTH admin (see below)
//
// Why two grants per project
// --------------------------
// Access today is a union: plan_projects.user_id (the owner) OR membership of
// plan_projects.team_id, and both currently carry full power. Backfilling only
// the owner would leave every OTHER member of a shared project with no grant at
// all, so the moment enforcement turns on they lose the workspace. So the team
// is granted too.
//
// Both get project_admin, not editor. Admin is exactly today's behaviour, so
// this migration changes nobody's effective access — it only makes that access
// expressible and revocable. Granting the team `project_editor` would look
// safer and is the trap: it is a silent privilege reduction that breaks running
// workflows with a 403 nobody can explain. Segregation of duties starts when an
// admin performs an explicit downgrade, not during a migration.
//
// Run (from backend/):
//   npm run build && node dist/backend/src/scripts/migrate_rbac_collections.js
//   # or: npx ts-node src/scripts/migrate_rbac_collections.ts
//
// Then verify before enabling enforcement:
//   node dist/backend/src/scripts/verify_rbac_backfill.js
//
// Idempotent: existing collections, attributes, indexes, policies and grants
// are skipped. Safe to re-run.
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { DatabasesIndexType } from 'node-appwrite';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { BUILTIN_ROLES } from '../authz/roles';
import { classifyAttributeFailure } from './lib/migrationErrors';
import { ACCESS_COLLECTION, backfillGrants } from '../authz/backfill';

// lib/appwrite falls back to a default endpoint when the env is absent, which
// for a migration means quietly writing to the wrong project. Refuse instead.
const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')}`);
  console.error(`        loaded .env from ${path.resolve(process.cwd(), '.env')} — run this from backend/`);
  process.exit(1);
}

const POLICIES = 'project_policies';
const ACCESS = ACCESS_COLLECTION;

type Attr =
  | { kind: 'string'; key: string; size: number; required: boolean; array?: boolean }
  | { kind: 'boolean'; key: string; required: boolean };

interface Spec {
  id: string;
  name: string;
  attributes: Attr[];
  indexes: { key: string; attributes: string[]; unique?: boolean }[];
}

const SPECS: Spec[] = [
  {
    id: POLICIES,
    name: 'Project Policies',
    attributes: [
      { kind: 'string', key: 'role_key', size: 64, required: true },
      { kind: 'string', key: 'name', size: 128, required: true },
      { kind: 'string', key: 'permissions', size: 64, required: true, array: true },
      // null for the global built-ins. v2 custom roles carry the owning project
      // here, and every policy read must filter on it — a shared mutable policy
      // row is a cross-tenant escalation channel.
      { kind: 'string', key: 'projectId', size: 64, required: false },
      { kind: 'boolean', key: 'is_builtin', required: false },
    ],
    indexes: [
      { key: 'role_key_idx', attributes: ['role_key'] },
      { key: 'projectId_idx', attributes: ['projectId'] },
    ],
  },
  {
    id: ACCESS,
    name: 'Project Access',
    attributes: [
      { kind: 'string', key: 'projectId', size: 64, required: true },
      { kind: 'string', key: 'subject_type', size: 16, required: true }, // 'user' | 'team'
      { kind: 'string', key: 'subject_id', size: 64, required: true },
      { kind: 'string', key: 'role_key', size: 64, required: true },
      // SOC2: a grant with no record of who made it is unauditable.
      { kind: 'string', key: 'granted_by', size: 64, required: true },
      { kind: 'string', key: 'granted_at', size: 64, required: true },
    ],
    indexes: [
      // Hot path: every authorization decision reads (projectId, subject_id).
      { key: 'project_subject_idx', attributes: ['projectId', 'subject_id'] },
      // "which projects can this subject see"
      { key: 'subject_idx', attributes: ['subject_id'] },
      // Counting remaining admins, to refuse a revoke that would orphan a project.
      { key: 'project_role_idx', attributes: ['projectId', 'role_key'] },
      // One role per subject per project. Also what makes the backfill
      // idempotent: a re-run collides with 409 instead of stacking duplicates.
      { key: 'project_subject_unique', attributes: ['projectId', 'subject_type', 'subject_id'], unique: true },
    ],
  },
];

const already = (raw: unknown): boolean => {
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Appwrite builds attributes asynchronously and an index on a still-processing
 * attribute fails. Poll real status rather than guessing with a fixed sleep.
 */
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
      else if (s === 'failed') {
        console.error(`  [ERR]  attribute "${key}" is in 'failed' state; delete and recreate it`);
        pending.delete(key);
      }
    }
    if (pending.size === 0) return;
    await sleep(2000);
  }
  console.warn(`  [WARN] attributes not available after ${timeoutMs}ms: ${[...pending].join(', ')} — indexes may fail`);
}

async function ensureCollection(spec: Spec): Promise<void> {
  console.log(`\nEnsuring collection "${spec.id}"...`);
  try {
    // Empty permissions, documentSecurity off: these are grant records. If the
    // browser could read them it could enumerate every tenant's membership; if
    // it could write them, RBAC would be self-service.
    await databases.createCollection(DB_ID, spec.id, spec.name, [], false);
    console.log('  [OK]   collection created');
  } catch (raw) {
    if (already(raw)) console.log('  [SKIP] collection already exists');
    else { console.error(`  [ERR]  collection: ${(raw as Error).message}`); process.exit(1); }
  }

  await sleep(1500);

  for (const a of spec.attributes) {
    try {
      if (a.kind === 'string') {
        await databases.createStringAttribute(DB_ID, spec.id, a.key, a.size, a.required, undefined, a.array ?? false);
      } else {
        await databases.createBooleanAttribute(DB_ID, spec.id, a.key, a.required);
      }
      console.log(`  [OK]   attribute "${a.key}"`);
    } catch (raw) {
      // Appwrite validates the row-size budget BEFORE it checks existence, so a
      // redundant create can surface as "maximum number or size of attributes
      // has been reached" rather than a conflict. Resolve the failure against
      // reality instead of printing [ERR] for a no-op on every re-run — a
      // migration that cries wolf is one whose real errors get skimmed past.
      const verdict = await classifyAttributeFailure(databases, DB_ID, spec.id, a.key, raw);
      if (verdict === 'skip') console.log(`  [SKIP] attribute "${a.key}" already exists`);
      else console.error(`  [ERR]  attribute "${a.key}": ${(raw as Error).message}`);
    }
  }

  await waitForAttributes(spec.id, [...new Set(spec.indexes.flatMap((i) => i.attributes))]);

  for (const idx of spec.indexes) {
    try {
      const type = idx.unique ? DatabasesIndexType.Unique : DatabasesIndexType.Key;
      await databases.createIndex(DB_ID, spec.id, idx.key, type, idx.attributes);
      console.log(`  [OK]   index "${idx.key}"${idx.unique ? ' (unique)' : ''}`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] index "${idx.key}" already exists`);
      else console.error(`  [ERR]  index "${idx.key}": ${(raw as Error).message}`);
    }
  }
}

async function seedBuiltinRoles(): Promise<void> {
  console.log('\nSeeding built-in roles...');
  for (const role of BUILTIN_ROLES) {
    const existing = await databases.listDocuments(DB_ID, POLICIES, [
      Query.equal('role_key', role.roleKey), Query.limit(1),
    ]);
    if (existing.total > 0) {
      // Overwrite rather than skip: the seed is the source of truth, and a
      // stale permission list here is an access-control bug.
      await databases.updateDocument(DB_ID, POLICIES, existing.documents[0].$id, {
        name: role.name, permissions: role.permissions, is_builtin: true,
      });
      console.log(`  [SYNC] ${role.roleKey} (${role.permissions.length} permissions)`);
      continue;
    }
    await databases.createDocument(DB_ID, POLICIES, ID.unique(), {
      role_key: role.roleKey, name: role.name, permissions: role.permissions,
      projectId: null, is_builtin: true,
    });
    console.log(`  [OK]   ${role.roleKey} (${role.permissions.length} permissions)`);
  }
}

async function run(): Promise<void> {
  for (const spec of SPECS) await ensureCollection(spec);
  await seedBuiltinRoles();

  console.log('\nBackfilling grants from plan_projects...');
  const tally = await backfillGrants();

  console.log('\n--- Backfill ---');
  console.log(`  projects scanned : ${tally.projects}`);
  console.log(`  grants written   : ${tally.granted}`);
  console.log(`  grants already   : ${tally.existing}`);
  console.log(`  unowned projects : ${tally.unowned.length}`);
  if (tally.unowned.length > 0) {
    // No user_id and no team_id: nothing to grant to, so these become
    // unreachable the moment enforcement turns on. Assign an owner first.
    console.warn('  [WARN] these projects have neither user_id nor team_id and received NO grant:');
    for (const id of tally.unowned) console.warn(`         ${id}`);
  }

  console.log('\nDone. Schema provisioned, roles seeded, grants backfilled.');
  console.log('Next: node dist/backend/src/scripts/verify_rbac_backfill.js — enforcement stays off until it passes.');
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
