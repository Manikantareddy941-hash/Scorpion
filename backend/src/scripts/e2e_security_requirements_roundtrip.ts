// backend/src/scripts/e2e_security_requirements_roundtrip.ts
//
// Proof-by-execution for the Security Requirements repository (feature 2a).
// Drives the real repository + engine end to end and confirms each row via a
// direct Appwrite getDocument — a 404 there would mean the write fell back to
// JSON. Also proves the array-merge persists, lifecycle survives regeneration,
// and dropped requirements are obsoleted (not deleted).
//
// dotenv MUST load before any app import (lib/appwrite reads env at import).
//
// Run:  cd backend && npx ts-node src/scripts/e2e_security_requirements_roundtrip.ts
import 'dotenv/config';
import { securityRequirementsRepository as repo } from '../repositories/securityRequirementsRepository';
import { generate, reconcile } from '../services/securityRequirementsEngine';
import { databases, DB_ID } from '../lib/appwrite';
import { ProjectProfile } from '../types/securityRequirements.types';

const REQUIREMENTS = 'plan_security_requirements';
const PROFILES = 'plan_project_profiles';
const projectId = `sec-rt-${Date.now()}`;
let failures = 0;

function check(cond: boolean, label: string): void {
  if (cond) console.log(`  [OK]   ${label}`);
  else { console.error(`  [FAIL] ${label}`); failures++; }
}

async function inAppwrite(collection: string, id: string): Promise<boolean> {
  try { await databases.getDocument(DB_ID, collection, id); return true; } catch { return false; }
}

async function run(): Promise<void> {
  console.log(`Security Requirements round-trip (project ${projectId})\n`);

  const profile: ProjectProfile = {
    projectId, appType: 'api', stack: ['node'], dataTypes: ['card'],
    deployment: 'cloud', authModel: 'session', frameworks: ['PCI DSS', 'SOC 2'],
  };

  // 1. Profile persists to Appwrite.
  await repo.upsertProfile(profile);
  const storedProfile = await repo.getProfile(projectId);
  check(!!storedProfile && storedProfile.frameworks.length === 2, 'profile upserted and read back with both frameworks');

  // 2. Generate + reconcile + persist; every requirement is in Appwrite.
  const gen1 = generate(profile);
  await repo.applyReconcile(projectId, reconcile(gen1, []));
  const list1 = await repo.listRequirements(projectId);
  check(list1.length === gen1.length, `persisted all ${gen1.length} generated requirements (got ${list1.length})`);

  let allInAppwrite = true;
  for (const r of list1) if (!(await inAppwrite(REQUIREMENTS, r.$id!))) allInAppwrite = false;
  check(allInAppwrite, 'every requirement is in Appwrite (not the JSON fallback)');

  // 3. Multi-framework merge persisted as an array.
  const mfa = list1.find((r) => r.code === 'REQ-AUTH-MFA');
  check(!!mfa && mfa.frameworks.length === 2 && mfa.status === 'required' && mfa.severity === 'high',
    'REQ-AUTH-MFA stored with merged frameworks[2], required, high');

  // 4. Lifecycle + audit identity persist.
  await repo.updateRequirement(mfa!.$id!, { lifecycleStatus: 'satisfied', justification: 'MFA enforced at IdP', updatedBy: 'auditor@x' });
  const reloaded = await repo.getRequirement(mfa!.$id!);
  check(reloaded?.lifecycleStatus === 'satisfied' && reloaded?.updatedBy === 'auditor@x',
    'satisfied + updatedBy persisted');

  // 5. Regenerate with SOC 2 dropped: SOC2-only reqs obsolete, MFA stays satisfied.
  const profile2: ProjectProfile = { ...profile, frameworks: ['PCI DSS'] };
  await repo.upsertProfile(profile2);
  const gen2 = generate(profile2);
  await repo.applyReconcile(projectId, reconcile(gen2, await repo.listRequirements(projectId)));
  const list2 = await repo.listRequirements(projectId);

  const soc2 = list2.find((r) => r.code === 'REQ-SOC2-CC7.2-MONITORING');
  check(soc2?.lifecycleStatus === 'obsolete', 'SOC2-only requirement obsoleted after framework dropped (not deleted)');

  const mfa2 = list2.find((r) => r.code === 'REQ-AUTH-MFA');
  check(mfa2?.lifecycleStatus === 'satisfied', 'still-applicable satisfied requirement kept its status through regenerate');
  check(!!mfa2 && mfa2.frameworks.length === 1 && mfa2.frameworks[0] === 'PCI DSS', 'MFA frameworks recomputed to [PCI DSS] only');

  // Cleanup.
  for (const r of list2) { try { await databases.deleteDocument(DB_ID, REQUIREMENTS, r.$id!); } catch { /* best effort */ } }
  const profileId = (storedProfile as unknown as { $id?: string } | null)?.$id;
  if (profileId) {
    try { await databases.deleteDocument(DB_ID, PROFILES, profileId); } catch { /* best effort */ }
  }

  console.log(`\n${failures === 0 ? 'PASS — repository persists to Appwrite; lifecycle + merge + reconcile all correct.' : `FAIL — ${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
