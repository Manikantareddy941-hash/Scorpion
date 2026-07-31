// backend/src/scripts/smoke_rbac_backfill.ts
//
// Proves the dual-grant backfill actually works against the real database.
//
// Why this exists: plan_projects is empty, so the migration's backfill ran over
// zero rows and the verifier passed vacuously. A green verifier on an empty
// table says nothing about whether a grant can be written, whether the unique
// index rejects a duplicate, or whether a team-owned project gets both grants —
// which is the whole day-zero-outage guarantee.
//
// This calls the SAME backfillGrants() the migration calls. It does not
// re-implement it; a test of a copy proves only that the copy works.
//
// Writes to the live database, then removes everything it wrote. The temporary
// project is named so it is obvious if cleanup ever fails.
//
// Run (from backend/, after the migration):
//   npm run build && node dist/backend/src/scripts/smoke_rbac_backfill.js
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { ACCESS_COLLECTION, backfillGrants } from '../authz/backfill';
import { ROLE_ADMIN } from '../authz/roles';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

const TEMP_USER = 'smoke-user-rbac';
const TEMP_TEAM = 'smoke-team-rbac';

let failures = 0;
const check = (ok: boolean, msg: string): void => {
  if (ok) console.log(`  [PASS] ${msg}`);
  else { failures += 1; console.error(`  [FAIL] ${msg}`); }
};

async function createTempProject(suffix: string, owner: { user_id?: string; team_id?: string }): Promise<string> {
  const doc = await databases.createDocument(DB_ID, 'plan_projects', ID.unique(), {
    name: `ZZ_SMOKE_DELETE_ME_${suffix}`,
    repoId: 'smoke',
    type: 'kanban',
    createdAt: new Date().toISOString(),
    ...owner,
  });
  return doc.$id;
}

async function grantsFor(projectId: string): Promise<{ subject_type?: string; subject_id?: string; role_key?: string }[]> {
  const list = await databases.listDocuments(DB_ID, ACCESS_COLLECTION, [
    Query.equal('projectId', projectId), Query.limit(25),
  ]);
  return list.documents as unknown as { subject_type?: string; subject_id?: string; role_key?: string }[];
}

async function cleanup(projectIds: string[]): Promise<void> {
  console.log('\nCleaning up...');
  for (const projectId of projectIds) {
    for (const g of await grantsFor(projectId)) {
      await databases.deleteDocument(DB_ID, ACCESS_COLLECTION, (g as unknown as { $id: string }).$id);
    }
    await databases.deleteDocument(DB_ID, 'plan_projects', projectId);
    console.log(`  removed ${projectId} and its grants`);
  }
}

async function main(): Promise<void> {
  console.log('RBAC backfill smoke test (writes to the live database, then cleans up)\n');

  const shared = await createTempProject('SHARED', { user_id: TEMP_USER, team_id: TEMP_TEAM });
  const personal = await createTempProject('PERSONAL', { user_id: TEMP_USER });
  const orphan = await createTempProject('ORPHAN', {});
  const created = [shared, personal, orphan];

  try {
    const first = await backfillGrants();
    console.log(`\nFirst run: ${first.granted} written, ${first.existing} already, ${first.unowned.length} unowned\n`);

    const sharedGrants = await grantsFor(shared);
    check(sharedGrants.length === 2, `team-owned project got BOTH grants (got ${sharedGrants.length})`);
    check(
      sharedGrants.some((g) => g.subject_type === 'team' && g.subject_id === TEMP_TEAM),
      'the team grant exists — this is what stops the day-zero outage',
    );
    check(
      sharedGrants.some((g) => g.subject_type === 'user' && g.subject_id === TEMP_USER),
      'the owner grant exists',
    );
    check(sharedGrants.every((g) => g.role_key === ROLE_ADMIN), 'both grants are project_admin, preserving current access');

    const personalGrants = await grantsFor(personal);
    check(personalGrants.length === 1, `owner-only project got exactly one grant (got ${personalGrants.length})`);

    check(first.unowned.includes(orphan), 'a project with no owner is reported as unowned rather than silently skipped');
    check((await grantsFor(orphan)).length === 0, 'the unowned project received no grant');

    // The idempotency guarantee: re-running must collide on the unique index,
    // not stack duplicates. Without this, every re-run doubles the grant table.
    const second = await backfillGrants();
    check(second.granted === 0, `re-run wrote no new grants (wrote ${second.granted})`);
    check(second.existing >= 3, `re-run hit the unique index instead of duplicating (${second.existing} conflicts)`);
    check((await grantsFor(shared)).length === 2, 'grant count unchanged after re-run');
  } finally {
    await cleanup(created);
  }

  console.log('');
  if (failures > 0) { console.error(`FAILED — ${failures} check(s).`); process.exit(1); }
  console.log('PASSED — the backfill writes both grants, reports unowned projects, and is idempotent.');
}

main().catch(async (e) => { console.error('[FATAL]', e); process.exit(1); });
