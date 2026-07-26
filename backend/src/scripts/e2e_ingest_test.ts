/**
 * Verifies that findings actually persist.
 *
 * The vulnerabilities collection required runId, source and title - three
 * attributes nothing in the codebase writes - so createDocument rejected every
 * finding. The newest stored document was dated 2026-05-14. Delta ingestion
 * catches the error and logs it, so scans reported success while storing
 * nothing. fix_vulnerabilities_schema.cjs relaxed those attributes; this
 * proves the write path works now rather than assuming it does.
 *
 * Writes a small number of clearly-labelled findings against a real repository
 * and a synthetic scan id, counts what landed, then deletes them. Nothing
 * pre-existing is touched.
 *
 * Usage: npx ts-node src/scripts/e2e_ingest_test.ts
 */
// dotenv must run before ../lib/appwrite is imported: that module builds its
// Client at import time, so a late load leaves the endpoint unset and every
// call 404s with general_route_not_found.
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { ingestVulnerabilitiesDelta } from '../services/scanService';

const MARKER = `e2e-ingest-${Date.now()}`;

(async () => {
  // A synthetic repo id, NOT a real one.
  //
  // ingestVulnerabilitiesDelta treats the incoming batch as the complete
  // current state of the repository and reconciles anything absent from it to
  // 'resolved'. Pointing this test at a real repository therefore marked every
  // one of that repo's open findings resolved - which is exactly what happened
  // the first time this ran, to 64 of them. Correct behaviour for a real scan,
  // catastrophic for a test.
  const repoId = `e2e-test-repo-${Date.now()}`;
  console.log(`using synthetic repository id ${repoId} (no real repo is touched)`);

  const before = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [Query.limit(1)]);
  console.log(`vulnerabilities before: ${before.total}`);

  // Shaped like real normalizer output, not a minimal stub: `tool` and
  // `message` are required columns and every scanner emits them, so a test
  // payload without them fails for a reason production never hits. It also
  // uses the normalizer's `file`/`line` names rather than the collection's
  // `file_path`/`line_number`, which is the mapping this is meant to prove.
  const issues = [
    { tool: 'trivy', type: 'security', file: 'package.json', line: 21, title: `${MARKER} lodash prototype pollution`, message: 'Prototype pollution in lodash < 4.17.12', severity: 'HIGH', cveId: 'CVE-2019-10744', code: '"lodash": "4.17.4"', reachability: 'reachable', fixAvailable: true },
    { tool: 'trivy', type: 'security', file: 'package.json', line: 8, title: `${MARKER} adm-zip path traversal`, message: 'Arbitrary file write via ../ in entry names', severity: 'CRITICAL', cveId: 'CVE-2018-1002204', code: '"adm-zip": "0.4.7"', reachability: 'unreachable', fixAvailable: true },
    { tool: 'semgrep', type: 'security', file: 'app.js', line: 42, title: `${MARKER} synthetic sast finding`, message: 'eval() on user-controlled input', severity: 'MEDIUM', code: 'eval(userInput)' },
  ];

  console.log(`\ningesting ${issues.length} findings...`);
  await ingestVulnerabilitiesDelta(repoId, MARKER, issues);

  // Read back by the scan id we just used — the only rows this test created.
  const landed = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
    Query.equal('scanId', MARKER),
    Query.limit(50),
  ]);

  console.log(`\nfindings persisted under scanId=${MARKER}: ${landed.total} of ${issues.length}`);
  for (const d of landed.documents) {
    console.log(`  [${d.tool}/${d.severity}] ${d.title ?? d.message} | status=${d.status}`);
    // The mapping is the point of this test: the input used file/line, so
    // anything stored under those names means toStoredFinding did not run.
    console.log(`     file_path=${d.file_path} line_number=${d.line_number} (input used file/line)`);
  }

  const verdict = landed.total === issues.length;
  console.log(`\n${verdict ? 'PASS — ingestion works' : 'FAIL — findings are still being dropped'}`);

  // Clean up: this is a test, not data.
  for (const d of landed.documents) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.VULNERABILITIES, d.$id).catch(() => {});
  }
  console.log(`cleaned up ${landed.documents.length} test documents`);

  const after = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [Query.limit(1)]);
  console.log(`vulnerabilities after cleanup: ${after.total} (was ${before.total})`);

  process.exit(verdict ? 0 : 1);
})().catch((e) => {
  console.error('ingest test failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
