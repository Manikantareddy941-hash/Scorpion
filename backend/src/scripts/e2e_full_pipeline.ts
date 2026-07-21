/**
 * Full pipeline verification: repo -> clone -> scan -> normalize -> persist -> read back.
 *
 * Exercises the same triggerScan path the API uses, against a real public
 * repository with documented vulnerabilities (snyk-labs/nodejs-goof). Creates a
 * dedicated throwaway repository record so no existing repo's findings are
 * touched - delta ingestion reconciles anything absent from the incoming batch
 * to 'resolved', which is why pointing a test at a real repo is destructive.
 *
 * Cleans up everything it creates. Run with --keep to leave the data in place
 * for inspecting the UI.
 *
 * Usage:
 *   npx ts-node src/scripts/e2e_full_pipeline.ts          # scan, verify, clean up
 *   npx ts-node src/scripts/e2e_full_pipeline.ts --keep   # leave data for the UI
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { triggerScan } from '../services/scanService';

const TARGET_REPO = 'https://github.com/snyk-labs/nodejs-goof';
const keep = process.argv.includes('--keep');

// --cleanup <repoId>: delete a kept throwaway repo, its scans and findings.
const cleanupIdx = process.argv.indexOf('--cleanup');
const cleanupTarget = cleanupIdx > -1 ? process.argv[cleanupIdx + 1] : null;

async function cleanup(repoId: string, scanIds: string[]) {
  let findings = 0;
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
    Query.equal('repo_id', repoId), Query.limit(500),
  ]);
  for (const d of res.documents) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.VULNERABILITIES, d.$id).catch(() => {});
    findings++;
  }
  for (const s of scanIds) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.SCANS, s).catch(() => {});
  }
  await databases.deleteDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId).catch(() => {});
  console.log(`cleaned up: ${findings} findings, ${scanIds.length} scans, 1 repository`);
}

(async () => {
  if (cleanupTarget) {
    // Guard: only delete a repo this script created, never a real one.
    const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, cleanupTarget).catch(() => null);
    if (!repo) { console.log(`repository ${cleanupTarget} not found — nothing to clean`); return; }
    if (!String(repo.name ?? '').includes('e2e verification')) {
      console.error(`REFUSING: ${cleanupTarget} (${repo.name}) is not an e2e verification repo.`);
      process.exit(1);
    }
    const scans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
      Query.equal('repo_id', cleanupTarget), Query.limit(100),
    ]);
    await cleanup(cleanupTarget, scans.documents.map((s) => s.$id));
    return;
  }

  // Owner is taken from an existing repository so the record is reachable by a
  // real account if --keep is used to inspect the UI.
  const existing = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.limit(1)]);
  const owner = existing.documents[0];
  if (!owner) throw new Error('no existing repository to copy ownership from');

  const repo = await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), {
    name: 'nodejs-goof (e2e verification)',
    url: TARGET_REPO,
    user_id: owner.user_id,
    ...(owner.team_id ? { team_id: owner.team_id } : {}),
    visibility: 'public',
    cron_enabled: false,
    cron_schedule: '0 0 * * *',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  console.log(`created throwaway repository ${repo.$id} -> ${TARGET_REPO}`);
  console.log(`owner: user_id=${owner.user_id}${owner.team_id ? ` team_id=${owner.team_id}` : ''}\n`);

  const scanIds: string[] = [];
  try {
    console.log('running triggerScan (clone -> orchestrate -> normalize -> ingest)...');
    const started = Date.now();
    const { scanId, error } = await triggerScan(repo.$id, { scanType: 'full' });
    console.log(`triggerScan returned after ${((Date.now() - started) / 1000).toFixed(1)}s: scanId=${scanId} error=${error ?? 'none'}`);
    if (scanId) scanIds.push(scanId);
    if (error) throw new Error(`scan reported: ${error}`);

    // 1. Did findings persist?
    const findings = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
      Query.equal('repo_id', repo.$id), Query.limit(500),
    ]);
    console.log(`\n=== PERSISTENCE ===`);
    console.log(`findings stored: ${findings.total}`);

    const bySeverity: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    let missingFilePath = 0;
    for (const f of findings.documents) {
      bySeverity[String(f.severity)] = (bySeverity[String(f.severity)] ?? 0) + 1;
      byTool[String(f.tool)] = (byTool[String(f.tool)] ?? 0) + 1;
      if (!f.file_path) missingFilePath++;
    }
    console.log(`by severity: ${JSON.stringify(bySeverity)}`);
    console.log(`by tool:     ${JSON.stringify(byTool)}`);
    console.log(`findings missing file_path: ${missingFilePath} (should be 0 — proves the field mapping ran)`);

    // 2. Did the scan record land, with counts that match the findings?
    const scan = scanId ? await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId).catch(() => null) : null;
    console.log(`\n=== SCAN RECORD ===`);
    if (!scan) {
      console.log('no scan document — the UI has nothing to show');
    } else {
      console.log(`status=${scan.status} critical=${scan.criticalCount} high=${scan.highCount} medium=${scan.mediumCount} low=${scan.lowCount}`);
      const storedTotal = (scan.criticalCount ?? 0) + (scan.highCount ?? 0) + (scan.mediumCount ?? 0) + (scan.lowCount ?? 0);
      console.log(`scan counts total=${storedTotal} vs findings stored=${findings.total} -> ${storedTotal === findings.total ? 'CONSISTENT' : 'MISMATCH (the dashboard would disagree with the issues list)'}`);
    }

    // 3. Would the tenant-scoped read path return them? Mirrors issuesRoutes.
    const scoped = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
      Query.equal('repo_id', [repo.$id]),
      Query.orderDesc('$createdAt'),
      Query.limit(100),
    ]);
    console.log(`\n=== READ PATH (mirrors /api/issues scoping) ===`);
    console.log(`returned: ${scoped.documents.length} findings`);
    if (scoped.documents.length) {
      const s = scoped.documents[0];
      console.log(`sample: [${s.tool}/${s.severity}] ${String(s.title ?? s.message).slice(0, 80)}`);
      console.log(`        file_path=${s.file_path} line_number=${s.line_number} status=${s.status}`);
    }

    const pass = findings.total > 0 && missingFilePath === 0 && scoped.documents.length > 0;
    console.log(`\n${pass ? 'PASS — the full pipeline stores and returns findings' : 'FAIL — see above'}`);

    if (keep) {
      console.log(`\n--keep: leaving repository ${repo.$id} and its ${findings.total} findings in place for UI inspection.`);
      console.log(`Clean up later with: npx ts-node src/scripts/e2e_full_pipeline.ts --cleanup ${repo.$id}`);
      process.exit(pass ? 0 : 1);
    }

    await cleanup(repo.$id, scanIds);
    process.exit(pass ? 0 : 1);
  } catch (e) {
    console.error('\npipeline failed:', e instanceof Error ? e.message : e);
    if (!keep) await cleanup(repo.$id, scanIds);
    process.exit(1);
  }
})();
