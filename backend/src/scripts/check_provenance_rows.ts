// backend/src/scripts/check_provenance_rows.ts
//
// READ-ONLY. Counts how many documents actually carry a `provenance` statement.
// Creates nothing, alters nothing, deletes nothing.
//
// WHY THIS EXISTS. check_provenance_attribute.ts answers what the column is
// declared as. This answers whether anything is in it — and only together do
// they support a decision.
//
// The case that matters is a column declared at 16384 with zero populated rows.
// Appwrite cannot shrink a string attribute in place, so correcting the size
// means deleteAttribute followed by createStringAttribute. That is data loss if
// and only if statements are already stored. If nothing is stored, the same
// operation is free.
//
// That window is open right now and closing on its own: the attestation writes
// in pipelineService and buildService are recent, so an environment migrated
// before them holds an empty column. Every build that attests from here on
// closes it permanently. Hence measuring rather than guessing.
//
// This script does NOT perform the recreation. It reports the number that makes
// the decision obvious and stops there — a script that can drop a column is a
// script that can drop a column by accident.
//
// Run from backend/, which is where dotenv resolves .env from:
//   npm run check:provenance-rows
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Query } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

// The same two collections migrate_build_provenance.ts targets, in the order
// deployService resolves them.
const TARGETS = ['pipeline_runs', COLLECTIONS.BUILD_PIPELINES];

/**
 * Counts documents matching a query without downloading them.
 *
 * limit(1) plus select(['$id']) because `total` is what is wanted and the
 * payloads are signed statements — there is no reason to pull provenance blobs
 * out of a production database to count them.
 */
async function countMatching(collection: string, queries: string[]): Promise<number> {
  const res = await databases.listDocuments(DB_ID, collection, [
    ...queries,
    Query.select(['$id']),
    Query.limit(1),
  ]);
  return res.total;
}

async function inspect(collection: string): Promise<void> {
  console.log(`\n${collection}`);

  let total: number;
  try {
    total = await countMatching(collection, []);
  } catch (err) {
    console.log(`  [!] cannot read collection: ${(err as Error).message}`);
    return;
  }

  let populated: number;
  try {
    // Optional attribute with no default, so unwritten documents hold null.
    populated = await countMatching(collection, [Query.isNotNull('provenance')]);
  } catch (err) {
    // Querying an attribute that does not exist fails here rather than
    // returning zero. That is a different answer from "exists and is empty",
    // and conflating them would make recreation look free when the column is
    // simply absent.
    console.log(`  [!] cannot query provenance: ${(err as Error).message}`);
    console.log(`      If the attribute does not exist, run check:provenance-attribute first.`);
    return;
  }

  // An attribute written as '' rather than null would not be caught above.
  // Nothing writes that today — both call sites write JSON.stringify(...) or
  // skip the write entirely — but an empty string is still a value, and
  // reporting it separately keeps a future regression visible instead of
  // silently counting as "safe to drop".
  let empties = 0;
  try {
    empties = await countMatching(collection, [Query.equal('provenance', '')]);
  } catch {
    // Older servers reject equality on an unindexed large string. Not fatal:
    // the isNotNull count above is the number the decision rests on.
    empties = -1;
  }

  console.log(`  documents:            ${total}`);
  console.log(`  with provenance:      ${populated}`);
  if (empties > 0) console.log(`  empty-string values:  ${empties}  (unexpected — investigate before dropping)`);

  if (populated === 0 && empties <= 0) {
    console.log(`  => No statements stored. Recreating this attribute at a smaller size`);
    console.log(`     would lose nothing. This is true only until the next build attests.`);
  } else {
    console.log(`  => ${populated} statement(s) stored. deleteAttribute would discard them.`);
    console.log(`     Leave the declared size alone.`);
  }
}

async function run(): Promise<void> {
  console.log(`Counting stored provenance statements in ${DB_ID}`);
  console.log('READ-ONLY — this script does not create, alter or delete anything.');

  for (const collection of TARGETS) {
    await inspect(collection);
  }

  console.log('\nPair this with check:provenance-attribute. A column declared at 16384');
  console.log('with zero stored statements is the only case where correcting the size');
  console.log('is free, and it stops being true as soon as a build attests.');
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
