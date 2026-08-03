// backend/src/scripts/migrate_scan_provenance.ts
//
// Adds provenance columns to `scans`: what each verdict was produced BY.
//
// "Clean" is not a durable statement. It means "clean against the signatures
// these scanners held at that moment". Without recording which images ran and
// how old their databases were, no past scan can be re-interpreted when a CVE
// lands — you cannot answer "was that release scanned against CVE-2026-X?"
// after the fact, and the honest answer today is "unknown".
//
// Two columns rather than the single `scannerDigest` originally sketched: a
// scan runs up to six tools with six different images, so one digest column
// would have to pick one arbitrarily and would be actively misleading about the
// other five.
//
//   scannerProvenance — JSON array, one entry per tool that reported
//   dbBuiltAt        — the OLDEST database among them, because a verdict is
//                      only as current as its weakest contributor. Sortable and
//                      filterable, which the JSON blob is not.
//
// Both are OPTIONAL. The docker and binary runners have no pinned image and no
// baked database, so their scans leave these absent — which is the truthful
// record, rather than a placeholder that would read as a pinned, dated scan.
//
// Run (from backend/):
//   npm run build && node dist/backend/src/scripts/migrate_scan_provenance.js
//
// Idempotent: an existing attribute is reported as a skip, not an error.
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { classifyAttributeFailure } from './lib/migrationErrors';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

const COLLECTION = COLLECTIONS.SCANS;

const ATTRIBUTES: { key: string; size: number; note: string }[] = [
  {
    key: 'scannerProvenance',
    // Six entries of ~200 bytes, with headroom. serializeProvenance() truncates
    // to this same ceiling rather than letting an oversize write fail the whole
    // scan record — losing the findings to save the metadata about them would
    // be the wrong trade.
    size: 4096,
    note: 'per-tool image digest + database age, JSON',
  },
  {
    key: 'dbBuiltAt',
    size: 64,
    note: 'oldest scanner database in the scan, ISO 8601',
  },
];

async function run(): Promise<void> {
  console.log(`Provisioning provenance attributes on "${COLLECTION}" in ${DB_ID}\n`);

  let failed = 0;
  const created: string[] = [];

  for (const attr of ATTRIBUTES) {
    try {
      // Optional, and no default. A default would stamp every historical scan
      // with a value implying it was pinned and dated when it was not.
      await databases.createStringAttribute(DB_ID, COLLECTION, attr.key, attr.size, false);
      created.push(attr.key);
      console.log(`  [+] created ${attr.key} (${attr.size}) — ${attr.note}`);
    } catch (err) {
      const verdict = await classifyAttributeFailure(databases, DB_ID, COLLECTION, attr.key, err);
      if (verdict === 'skip') {
        console.log(`  [=] skip (exists): ${attr.key}`);
      } else {
        failed += 1;
        console.error(`  [ERR] ${attr.key}: ${(err as Error).message}`);
      }
    }
  }

  console.log('');
  if (failed > 0) {
    console.error(`FAILED — ${failed} attribute(s) could not be provisioned.`);
    process.exit(1);
  }

  console.log(created.length > 0
    ? `Done. Created: ${created.join(', ')}.`
    : 'Done. Nothing to do — both attributes were already present.');
  console.log('Existing scans keep both fields empty; only scans run after the');
  console.log('Kubernetes runner is enabled will carry provenance.');
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
