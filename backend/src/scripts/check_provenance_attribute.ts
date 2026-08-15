// backend/src/scripts/check_provenance_attribute.ts
//
// READ-ONLY. Reports how the `provenance` attribute is actually declared in a
// live Appwrite project. Creates nothing, alters nothing, deletes nothing.
//
// WHY THIS EXISTS. migrate_build_provenance.ts now declares PROVENANCE_SIZE at
// 4096, but that constant only describes environments the migration has not yet
// run against. An attribute created earlier at 16384 stays 16384: the migration
// skips attributes that already exist, and Appwrite does not shrink a string
// attribute in place. So the value in the source file is not evidence about any
// deployed environment — this script is.
//
// Correcting an oversized column means deleting and recreating it, which
// discards every SLSA statement stored in it. That is a data-loss operation and
// is deliberately NOT automated here. Read the number, then decide.
//
// It also sums the declared sizes of every string attribute in each collection.
// Appwrite validates the collection row-size budget BEFORE it checks whether an
// attribute already exists (see scripts/lib/migrationErrors.ts), so a migration
// that overruns the budget reports "maximum number or size of attributes has
// been reached" while naming neither the attribute nor the real cause. The sum
// is the number that makes that failure predictable instead of mysterious.
//
// Run from backend/, which is where dotenv resolves .env from:
//   npm run check:provenance-attribute
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Query } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';

/** Matches migrate_build_provenance.ts. Asserted against `total`, not assumed. */
const ATTRIBUTE_PAGE_LIMIT = 200;

/** What migrate_build_provenance.ts would create today, for comparison only. */
const EXPECTED_SIZE = 4096;

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

// The same two collections migrate_build_provenance.ts targets, in the order
// deployService resolves them.
const TARGETS = ['pipeline_runs', COLLECTIONS.BUILD_PIPELINES];

/** Only the fields this script reads. Avoids `any` while not restating Appwrite's model. */
interface AttributeView {
  key: string;
  type: string;
  size?: number;
  required?: boolean;
  status?: string;
}

async function inspect(collection: string): Promise<void> {
  console.log(`\n${collection}`);

  let list;
  try {
    list = await databases.listAttributes(DB_ID, collection, [Query.limit(ATTRIBUTE_PAGE_LIMIT)]);
  } catch (err) {
    // A collection that does not exist is a real answer, not a crash: it means
    // the migration has not run here at all.
    console.log(`  [!] cannot read: ${(err as Error).message}`);
    return;
  }

  if (list.total > ATTRIBUTE_PAGE_LIMIT) {
    console.log(`  [!] ${list.total} attributes, more than the ${ATTRIBUTE_PAGE_LIMIT} read — view is partial`);
  }

  const attributes = list.attributes as unknown as AttributeView[];
  const provenance = attributes.find((a) => a.key === 'provenance');

  if (!provenance) {
    console.log(`  provenance:  NOT PRESENT — migration has not run here.`);
    console.log(`               Running it now creates it at ${EXPECTED_SIZE}.`);
  } else {
    const size = provenance.size ?? 0;
    console.log(`  provenance:  size=${size}  required=${provenance.required}  status=${provenance.status}`);
    if (size === EXPECTED_SIZE) {
      console.log(`               matches the current constant (${EXPECTED_SIZE}).`);
    } else {
      console.log(`               DIFFERS from the current constant (${EXPECTED_SIZE}).`);
      console.log(`               Editing PROVENANCE_SIZE does not change this. Appwrite does`);
      console.log(`               not shrink a string attribute in place; recreating the column`);
      console.log(`               discards the statements already stored in it.`);
    }
  }

  // String attributes are what consume the row-size budget.
  const strings = attributes.filter((a) => a.type === 'string');
  const declared = strings.reduce((sum, a) => sum + (a.size ?? 0), 0);
  console.log(`  string attributes: ${strings.length}, declared total ${declared} bytes`);

  const widest = [...strings].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)).slice(0, 3);
  for (const a of widest) {
    console.log(`    ${String(a.size).padStart(6)}  ${a.key}`);
  }
}

async function run(): Promise<void> {
  console.log(`Reading provenance attribute state from ${DB_ID}`);
  console.log('READ-ONLY — this script does not create, alter or delete anything.');

  for (const collection of TARGETS) {
    await inspect(collection);
  }

  console.log('\nAn absent attribute means the migration has not run in this environment.');
  console.log('A size other than 4096 means it ran before the constant was corrected,');
  console.log('and that environment keeps the size it was created with.');
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
