// backend/src/scripts/verify_rbac_backfill.ts
//
// READ-ONLY. Proves the RBAC backfill is complete before enforcement is turned
// on. Exits non-zero on any failure, so it can gate the rollout in CI.
//
// The failure this exists to prevent: enforcement flips to deny-by-default over
// an incomplete grant table, and a team silently loses a project it has been
// working in. That is indistinguishable from a permissions bug at 3am, so the
// count is checked BEFORE the flag rather than diagnosed after it.
//
// Run (from backend/, after the migration):
//   npm run build && node dist/backend/src/scripts/verify_rbac_backfill.js
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { fetchAllDocuments } from '../lib/paginate';
import { BUILTIN_ROLES, ROLE_ADMIN } from '../authz/roles';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

const failures: string[] = [];
const fail = (msg: string): void => { failures.push(msg); console.error(`  [FAIL] ${msg}`); };
const pass = (msg: string): void => console.log(`  [PASS] ${msg}`);

interface AccessDoc { projectId?: string; subject_type?: string; subject_id?: string; role_key?: string; }
interface PolicyDoc { role_key?: string; permissions?: string[]; }
interface ProjectDoc { $id: string; user_id?: string; team_id?: string | null; }

async function readAll<T>(collectionId: string): Promise<T[]> {
  const page = await fetchAllDocuments(collectionId, [], { maxItems: 100000 });
  if (page.truncated) {
    // A truncated read cannot prove completeness — the missing rows are exactly
    // the ones that would fail the check. Refuse to report a verdict.
    fail(`${collectionId}: read truncated at ${page.items.length}/${page.total} — cannot verify`);
  }
  return page.items as unknown as T[];
}

async function main(): Promise<void> {
  console.log('Verifying RBAC backfill...\n');

  const projects = await readAll<ProjectDoc>('plan_projects');
  const grants = await readAll<AccessDoc>('project_access');
  const policies = await readAll<PolicyDoc>('project_policies');

  // 1. Every built-in role is seeded with the permissions the code expects.
  console.log('Policies:');
  for (const role of BUILTIN_ROLES) {
    const found = policies.filter((p) => p.role_key === role.roleKey);
    if (found.length === 0) { fail(`role "${role.roleKey}" is not seeded`); continue; }
    if (found.length > 1) { fail(`role "${role.roleKey}" has ${found.length} rows — resolution is ambiguous`); continue; }
    const seeded = new Set(found[0].permissions ?? []);
    const drifted = role.permissions.filter((p) => !seeded.has(p));
    if (drifted.length > 0) fail(`role "${role.roleKey}" is missing: ${drifted.join(', ')}`);
    else pass(`role "${role.roleKey}" (${seeded.size} permissions)`);
  }

  // 2. Every grant points at a role that exists. A dangling role_key resolves
  //    to an empty permission set, which is a silent lockout of that subject.
  const roleKeys = new Set(policies.map((p) => p.role_key));
  const dangling = grants.filter((g) => !roleKeys.has(g.role_key));
  console.log('\nGrants:');
  if (dangling.length > 0) fail(`${dangling.length} grant(s) reference a role that does not exist`);
  else pass(`all ${grants.length} grant(s) resolve to a seeded role`);

  // 3. THE gate: projects_with_grants === total_projects.
  const granted = new Set(grants.map((g) => g.projectId));
  const ungranted = projects.filter((p) => !granted.has(p.$id));
  console.log('\nCoverage:');
  console.log(`  projects: ${projects.length}   with grants: ${projects.length - ungranted.length}`);
  if (ungranted.length > 0) {
    fail(`${ungranted.length} project(s) have NO grant and would be inaccessible under enforcement`);
    for (const p of ungranted.slice(0, 20)) {
      const why = !p.user_id && !p.team_id ? 'unowned (no user_id, no team_id)' : 'backfill missed it';
      console.error(`         ${p.$id} — ${why}`);
    }
    if (ungranted.length > 20) console.error(`         ...and ${ungranted.length - 20} more`);
  } else {
    pass('projects_with_grants === total_projects');
  }

  // 4. The team half of the dual grant. Owner-only backfill is the day-zero
  //    outage: every non-owner member of a shared project loses it at cutover.
  const teamGranted = new Set(grants.filter((g) => g.subject_type === 'team').map((g) => g.projectId));
  const missingTeam = projects.filter((p) => p.team_id && !teamGranted.has(p.$id));
  if (missingTeam.length > 0) fail(`${missingTeam.length} team-owned project(s) have no team grant — their members lose access`);
  else pass('every team-owned project has a team grant');

  // 5. No project is left unadministrable.
  const adminProjects = new Set(grants.filter((g) => g.role_key === ROLE_ADMIN).map((g) => g.projectId));
  const noAdmin = projects.filter((p) => !adminProjects.has(p.$id));
  if (noAdmin.length > 0) fail(`${noAdmin.length} project(s) have no admin — nobody can manage access`);
  else pass('every project has at least one admin');

  console.log('');
  if (failures.length > 0) {
    console.error(`FAILED — ${failures.length} check(s). Do NOT enable enforcement.`);
    process.exit(1);
  }
  console.log('PASSED — backfill is complete. Safe to enable RBAC enforcement.');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
