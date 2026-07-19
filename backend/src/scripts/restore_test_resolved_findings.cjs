/**
 * Repairs findings wrongly marked resolved by an ingestion test.
 *
 * e2e_ingest_test.ts called ingestVulnerabilitiesDelta with a 3-issue batch
 * against a real repository. Delta ingestion treats the incoming batch as the
 * complete current state, so every open finding for that repo that was not in
 * the batch got reconciled to 'resolved'. That is correct behaviour for a real
 * scan and completely wrong for a test - the test should have used a throwaway
 * repo id.
 *
 * The delta only ever transitions documents whose status was 'open'
 * (scanService queries Query.equal('status','open') to build its active set),
 * so restoring them to 'open' and clearing resolvedAt returns them exactly to
 * their prior state. No other field was touched.
 *
 * Scope is deliberately narrow: only documents resolved inside the given time
 * window, so genuinely resolved findings from before the test are untouched.
 *
 * Usage:
 *   node src/scripts/restore_test_resolved_findings.cjs              # dry run
 *   node src/scripts/restore_test_resolved_findings.cjs --apply
 */
const sdk = require('node-appwrite');
require('dotenv').config({ path: '.env' });

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new sdk.Databases(client);
const DB = process.env.APPWRITE_DATABASE_ID;

// Only documents resolved within this many minutes are candidates.
const WINDOW_MINUTES = Number(process.env.RESTORE_WINDOW_MINUTES || 45);

(async () => {
  const apply = process.argv.includes('--apply');
  const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const candidates = [];
  let cursor = null;
  for (;;) {
    const q = [sdk.Query.limit(100)];
    if (cursor) q.push(sdk.Query.cursorAfter(cursor));
    const res = await db.listDocuments(DB, 'vulnerabilities', q);
    for (const d of res.documents) {
      if (d.status === 'resolved' && d.resolvedAt && d.resolvedAt > cutoff) candidates.push(d);
    }
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — resolved within the last ${WINDOW_MINUTES} minutes: ${candidates.length}`);
  const byRepo = {};
  for (const d of candidates) byRepo[d.repo_id] = (byRepo[d.repo_id] || 0) + 1;
  console.log('by repo:', JSON.stringify(byRepo));

  if (!apply) {
    console.log('\nEach would be set back to status="open" with resolvedAt cleared.');
    console.log('Run with --apply to restore.');
    return;
  }

  let ok = 0, failed = 0;
  for (const d of candidates) {
    try {
      await db.updateDocument(DB, 'vulnerabilities', d.$id, { status: 'open', resolvedAt: null });
      ok++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.log(`  failed ${d.$id}: ${e.message}`);
    }
  }
  console.log(`restored=${ok} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
