// backend/src/scripts/smoke_rbac_enforcement.ts
//
// Proves the NON-OWNER path against the real database — the half that unit
// tests cover and live traffic does not, because an owner is project_admin with
// a wildcard and therefore exercises none of it.
//
// No second account required. Authorization is keyed on a user id, not on a
// session, so a synthetic subject id proves the same code path a real teammate
// would take: grant, evaluate, service-level access, role change, and the
// last-admin guard.
//
// Writes to the live database and removes everything it wrote.
//
// Run (from backend/):
//   npm run build && node dist/backend/src/scripts/smoke_rbac_enforcement.js
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { ACCESS_COLLECTION } from '../authz/backfill';
import { evaluate, resetPolicyCache } from '../authz/authorizationService';
import { projectAccessService } from '../services/projectAccessService';
import { assertLegacyProjectAccess, assertProjectAccess } from '../services/planService';
import { PlanPermission } from '../authz/roles';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

const OWNER = 'smoke-owner-rbac';
const VIEWER = 'smoke-viewer-rbac';
const EDITOR = 'smoke-editor-rbac';
const STRANGER = 'smoke-stranger-rbac';

let failures = 0;
const check = (ok: boolean, msg: string): void => {
  if (ok) console.log(`  [PASS] ${msg}`);
  else { failures += 1; console.error(`  [FAIL] ${msg}`); }
};

const can = async (projectId: string, userId: string, p: PlanPermission): Promise<boolean> =>
  (await evaluate(projectId, userId, p)).allowed;

async function cleanup(projectId: string): Promise<void> {
  const grants = await databases.listDocuments(DB_ID, ACCESS_COLLECTION, [
    Query.equal('projectId', projectId), Query.limit(50),
  ]);
  for (const g of grants.documents) await databases.deleteDocument(DB_ID, ACCESS_COLLECTION, g.$id);
  await databases.deleteDocument(DB_ID, 'plan_projects', projectId);
  console.log(`\nCleaned up ${projectId} and ${grants.documents.length} grant(s)`);
}

async function main(): Promise<void> {
  console.log('RBAC enforcement smoke test — non-owner paths (writes to the live database, then cleans up)\n');
  resetPolicyCache();

  const project = await databases.createDocument(DB_ID, 'plan_projects', ID.unique(), {
    name: 'ZZ_SMOKE_DELETE_ME_ENFORCEMENT', repoId: 'smoke', type: 'kanban',
    createdAt: new Date().toISOString(), user_id: OWNER,
  });
  const projectId = project.$id;

  try {
    // The owner grant the create path would normally write.
    await projectAccessService.grant(projectId, { subjectType: 'user', subjectId: OWNER, roleKey: 'project_admin' }, OWNER);

    console.log('Owner:');
    check(await can(projectId, OWNER, 'access:write'), 'admin holds access:write through the wildcard');
    check(await can(projectId, OWNER, 'issue:delete'), 'admin holds issue:delete');

    console.log('\nStranger (no grant):');
    const strangerVerdict = await evaluate(projectId, STRANGER, 'issue:read');
    check(strangerVerdict.reason === 'not_found',
      `a caller with no grant gets not_found, not denied — no project enumeration (got ${strangerVerdict.reason})`);
    check(!(await assertProjectAccess(projectId, STRANGER)), 'the service layer refuses a stranger too');

    console.log('\nViewer:');
    await projectAccessService.grant(projectId, { subjectType: 'user', subjectId: VIEWER, roleKey: 'project_viewer' }, OWNER);
    check(await can(projectId, VIEWER, 'issue:read'), 'viewer can read issues');
    check(!(await can(projectId, VIEWER, 'issue:write')), 'viewer cannot write issues');
    check(!(await can(projectId, VIEWER, 'issue:delete')), 'viewer cannot delete issues');
    check(!(await can(projectId, VIEWER, 'access:read')), 'viewer cannot see the grant table');

    // THE regression this suite exists for: the viewer is neither owner nor
    // teammate, so the legacy union refuses them. If the service layer still
    // used it alone, every assigned role would be inert.
    check(!(await assertLegacyProjectAccess(projectId, VIEWER)), 'the legacy union alone would have refused the viewer');
    check(await assertProjectAccess(projectId, VIEWER), 'the service layer admits the viewer on the strength of the grant');

    console.log('\nEditor:');
    await projectAccessService.grant(projectId, { subjectType: 'user', subjectId: EDITOR, roleKey: 'project_editor' }, OWNER);
    check(await can(projectId, EDITOR, 'issue:write'), 'editor can write issues');
    check(await can(projectId, EDITOR, 'issue:delete'), 'editor can delete issues');
    check(!(await can(projectId, EDITOR, 'epic:delete')), 'editor cannot delete an epic');
    check(!(await can(projectId, EDITOR, 'automation:write')), 'editor cannot reconfigure automation');
    check(!(await can(projectId, EDITOR, 'access:write')), 'editor cannot grant themselves more');

    console.log('\nRole changes:');
    await projectAccessService.changeRole(projectId, VIEWER, 'project_editor', OWNER);
    check(await can(projectId, VIEWER, 'issue:write'), 'a promotion takes effect immediately');
    await projectAccessService.changeRole(projectId, VIEWER, 'project_viewer', OWNER);
    check(!(await can(projectId, VIEWER, 'issue:write')), 'a demotion takes effect immediately');

    console.log('\nGuards:');
    check(await projectAccessService.changeRole(projectId, OWNER, 'project_viewer', OWNER) === 'last_admin',
      'the only admin cannot demote themselves');
    check(await projectAccessService.revoke(projectId, OWNER, OWNER) === 'last_admin',
      'the only admin cannot revoke themselves');
    check(await projectAccessService.grant(projectId, { subjectType: 'user', subjectId: VIEWER, roleKey: 'project_admin' }, OWNER) === 'already_granted',
      're-granting an existing subject is refused rather than overwriting');
    check(await projectAccessService.grant(projectId, { subjectType: 'user', subjectId: 'x', roleKey: 'project_god' }, OWNER) === 'invalid_role',
      'an unseeded role is refused');

    console.log('\nRevocation:');
    check(await projectAccessService.revoke(projectId, EDITOR, OWNER) === 'ok', 'a non-last-admin can be revoked');
    const after = await evaluate(projectId, EDITOR, 'issue:read');
    check(after.reason === 'not_found', `a revoked subject loses access at once (got ${after.reason})`);
  } finally {
    await cleanup(projectId);
  }

  console.log('');
  if (failures > 0) { console.error(`FAILED — ${failures} check(s). Do NOT set RBAC_ENFORCE=true.`); process.exit(1); }
  console.log('PASSED — non-owner roles resolve, guards hold, and revocation is immediate.');
}

main().catch(async (e) => { console.error('[FATAL]', e); process.exit(1); });
