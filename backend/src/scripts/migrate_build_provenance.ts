// backend/src/scripts/migrate_build_provenance.ts
//
// Adds a durable `provenance` attribute to the two collections a deploy resolves
// a build from: `pipeline_runs` and `build_pipelines`.
//
// NOT THE SAME THING AS migrate_scan_provenance.ts. That one records which
// SCANNER images produced a verdict, on `scans`. This one stores the signed SLSA
// statement describing how the IMAGE was built. The word is shared, the concept
// is not — check which you mean before touching either.
//
// WHY DURABLE STORAGE. attestProvenance already signs a statement, and
// imageStore.putProvenance already stores it — in Redis on a 1-hour TTL, with a
// bounded in-process LRU as fallback. That window is sized for CI-build ->
// admission. A deploy gate that reads provenance back cannot rely on it: any
// deploy of an image built more than an hour ago, or after a restart, finds
// nothing and can only report "unverifiable". A gate that is structurally
// unable to judge is the failure mode issue #186 describes, reproduced.
//
// Recording the statement on the build/run record instead makes it last as long
// as the record that references it.
//
// IT ALSO FIXES THE TENANCY CLAIM IN #187. buildService writes provenance with a
// null tenant, into imageStore's shared namespace, justified by a comment saying
// provenance is "signed and verified rather than trusted by key". Both these
// collections are already repo-scoped, so a statement stored here inherits the
// tenancy the shared Redis namespace never had.
//
// BOTH COLLECTIONS, not just build_pipelines. deployService resolves a build by
// reading pipeline_runs FIRST and falling back to build_pipelines, and today only
// buildService attests provenance at all — pipelineService, the primary path,
// writes imageDigest/imageSignature and no statement. Provisioning one collection
// would leave the primary path unable to produce what the gate reads, which is
// the drift #190 warns about.
//
// Run (from backend/):
//   npm run build && node dist/backend/src/scripts/migrate_build_provenance.js
//
// Idempotent: an existing attribute is reported as a skip, not an error.
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Query } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { classifyAttributeFailure } from './lib/migrationErrors';

/** Well above any collection here, and asserted against `total` rather than assumed. */
const ATTRIBUTE_PAGE_LIMIT = 200;

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

/**
 * A signed SLSA statement is the subject array plus the predicate (builder id,
 * invocation id, materials, timestamps) and a base64 cosign signature. Measured
 * against the statements attestProvenance currently produces, that lands in the
 * low single-digit KB; 16KB leaves room for a materials list to grow without a
 * second migration.
 *
 * Oversize is a real risk worth naming: Appwrite rejects the whole write, and
 * these are written alongside the build record. The write path must treat a
 * provenance write as best-effort for that reason — losing the build record to
 * save the metadata about it would be the wrong trade, the same call
 * migrate_scan_provenance.ts made by truncating.
 */
const PROVENANCE_SIZE = 16384;

const TARGETS: { collection: string; note: string }[] = [
  {
    collection: 'pipeline_runs',
    note: 'primary path — deployService resolves this first',
  },
  {
    collection: COLLECTIONS.BUILD_PIPELINES,
    note: 'fallback path — deployService reads this only when the run is absent',
  },
];

/**
 * Reads a collection once before touching it.
 *
 * Turns "does this attribute already exist" into a fact rather than something
 * inferred from the text of a failure, and separates a PROJECT-level problem —
 * paused, wrong endpoint, revoked key — from an attribute-level one.
 */
async function existingAttributeKeys(collection: string): Promise<Set<string>> {
  try {
    // listAttributes pages at 25 by default. Without an explicit limit an
    // existing attribute past the first page reads as absent, and the preflight
    // would confidently try to create something already there.
    const list = await databases.listAttributes(DB_ID, collection, [Query.limit(ATTRIBUTE_PAGE_LIMIT)]);
    if (list.total > ATTRIBUTE_PAGE_LIMIT) {
      throw new Error(
        `collection has ${list.total} attributes, more than the ${ATTRIBUTE_PAGE_LIMIT} read here — raise the limit rather than trusting a partial view`,
      );
    }
    return new Set(list.attributes.map((a) => (a as { key: string }).key));
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[FATAL] cannot read collection "${collection}" — nothing was changed.`);
    console.error(`        ${message}`);
    if (/paused/i.test(message)) {
      console.error('        Restore the project from the Appwrite console, then re-run this script.');
    }
    process.exit(1);
  }
}

async function run(): Promise<void> {
  console.log(`Provisioning build provenance in ${DB_ID}\n`);

  let failed = 0;
  const created: string[] = [];

  for (const target of TARGETS) {
    console.log(`${target.collection} — ${target.note}`);
    const existing = await existingAttributeKeys(target.collection);

    if (existing.has('provenance')) {
      console.log('  [=] skip (exists): provenance\n');
      continue;
    }

    try {
      // Optional, and no default. A default would stamp every historical build
      // with a value implying a statement was recorded when none was.
      await databases.createStringAttribute(DB_ID, target.collection, 'provenance', PROVENANCE_SIZE, false);
      created.push(`${target.collection}.provenance`);
      console.log(`  [+] created provenance (${PROVENANCE_SIZE}) — signed SLSA statement, JSON\n`);
    } catch (err) {
      const verdict = await classifyAttributeFailure(databases, DB_ID, target.collection, 'provenance', err);
      if (verdict === 'skip') {
        console.log('  [=] skip (exists): provenance\n');
      } else {
        failed += 1;
        console.error(`  [ERR] ${target.collection}.provenance: ${(err as Error).message}\n`);
      }
    }
  }

  if (failed > 0) {
    console.error(`FAILED — ${failed} attribute(s) could not be provisioned.`);
    process.exit(1);
  }

  console.log(created.length > 0
    ? `Done. Created: ${created.join(', ')}.`
    : 'Done. Nothing to do — provenance was already present on both collections.');
  console.log('Existing builds keep the field empty. A deploy gate must read that');
  console.log('absence as "no statement recorded", never as "verified".');
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
