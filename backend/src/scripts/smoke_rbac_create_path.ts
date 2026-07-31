// backend/src/scripts/smoke_rbac_create_path.ts
//
// Exercises planService.createProject — the real function the POST /projects
// route calls — against the live database.
//
// This is the code from the create-path grant fix, and until now it was covered
// only by mocked unit tests. What it must prove: the project lands in Appwrite,
// BOTH grants are stamped in the same operation, and the run produces no
// project_grant_skipped_fallback (which would mean the write went to the local
// JSON store and nothing here is real).
//
// It does NOT cover the browser, the JWT, the auth middleware or the route.
// Those need a real session and remain a manual check.
//
// Writes to the live database and removes everything it wrote.
//
// Run (from backend/):
//   npm run build && node dist/backend/src/scripts/smoke_rbac_create_path.js
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID, Query } from '../lib/appwrite';
import { ACCESS_COLLECTION } from '../authz/backfill';
import { planService } from '../services/planService';
import { planRepository } from '../repositories/planRepository';
import { evaluate } from '../authz/authorizationService';
import { logger } from '../services/logger';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

const OWNER = 'smoke-createpath-user';
const TEAM = 'smoke-createpath-team';

let failures = 0;
const check = (ok: boolean, msg: string): void => {
  if (ok) console.log(`  [PASS] ${msg}`);
  else { failures += 1; console.error(`  [FAIL] ${msg}`); }
};

/**
 * The fallback warning is the whole point of watching this run: if the project
 * went to scratch/plan_mock_db.json then no grant exists, nothing reached
 * Appwrite, and every downstream assertion would be measuring a ghost.
 */
let sawFallbackWarning = false;
const realWarn = logger.warn.bind(logger);
// Cast back to the logger's own signature: winston returns the Logger for
// chaining, so a void wrapper would not be assignable.
logger.warn = ((message: string, meta?: unknown) => {
  if ((meta as { event?: string })?.event === 'project_grant_skipped_fallback') sawFallbackWarning = true;
  return realWarn(message, meta);
}) as typeof logger.warn;

const grantsFor = async (projectId: string) => {
  const list = await databases.listDocuments(DB_ID, ACCESS_COLLECTION, [
    Query.equal('projectId', projectId), Query.limit(25),
  ]);
  return list.documents as unknown as { $id: string; subject_type: string; subject_id: string; role_key: string }[];
};

async function cleanup(projectId: string): Promise<void> {
  for (const g of await grantsFor(projectId)) {
    await databases.deleteDocument(DB_ID, ACCESS_COLLECTION, g.$id);
  }
  await databases.deleteDocument(DB_ID, 'plan_projects', projectId).catch(() => undefined);
  console.log(`\nCleaned up ${projectId} and its grants`);
}

async function main(): Promise<void> {
  console.log('Create-path smoke test — planService.createProject against the live database\n');

  const project = await planService.createProject(
    { name: 'ZZ_SMOKE_DELETE_ME_CREATEPATH', type: 'kanban' }, OWNER, TEAM,
  );

  try {
    check(!sawFallbackWarning,
      'no project_grant_skipped_fallback — the write reached Appwrite, not the local JSON store');
    check(await planRepository.projectExistsInAppwrite(project.$id),
      'the project is readable from Appwrite directly');

    const grants = await grantsFor(project.$id);
    check(grants.length === 2, `the create path stamped BOTH grants (got ${grants.length})`);
    check(grants.some((g) => g.subject_type === 'user' && g.subject_id === OWNER), 'the owner grant exists');
    check(grants.some((g) => g.subject_type === 'team' && g.subject_id === TEAM), 'the team grant exists');
    check(grants.every((g) => g.role_key === 'project_admin'), 'both are project_admin');

    // What the divergence telemetry should show for a freshly created project:
    // the owner holds the wildcard, so RBAC agrees with the legacy check and
    // rbac_divergence stays silent.
    const verdict = await evaluate(project.$id, OWNER, 'issue:delete');
    check(verdict.allowed, `the creator can act on their own project immediately (${verdict.reason})`);
    check((await evaluate(project.$id, 'nobody-at-all', 'issue:read')).reason === 'not_found',
      'a stranger still gets not_found');
  } finally {
    await cleanup(project.$id);
  }

  console.log('');
  if (failures > 0) { console.error(`FAILED — ${failures} check(s).`); process.exit(1); }
  console.log('PASSED — the create path writes the project and both grants in one operation.');
  console.log('Still manual: browser session -> JWT -> auth middleware -> route.');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
