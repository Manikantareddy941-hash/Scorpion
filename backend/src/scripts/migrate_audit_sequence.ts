// backend/src/scripts/migrate_audit_sequence.ts
//
// Adds the `sequence` attribute to `audit_logs_v2`: each ledger row's position in
// the hash chain.
//
// WHY A SCRIPT WHEN THE APP ALREADY DOES THIS LAZILY.
//
// utils/tamperAuditLogger.ensureSequenceAttribute creates the attribute on first
// audit write. That is the right safety net for fresh installs and for any
// environment nobody remembered to migrate — but it is the wrong place to
// DISCOVER a problem. Its failure lands on whoever happens to trigger the next
// audit write, and with `{ required: true }` the first such caller is likely to be
// a break-glass override: the one operation you least want to refuse.
//
// So this exists to move the failure earlier, to an operator who is watching. Run
// it before promoting a build that depends on sequencing. Keep the lazy path too;
// they cover different environments.
//
// WHAT IT DOES NOT DO.
//
// It does not back-fill existing rows. Rows written before sequencing carry no
// position, and assigning them one would mean rewriting an append-only ledger to
// make it look like it had always been sequenced — the exact class of edit the
// ledger exists to make visible. The verifier reads a mid-chain position 0 as the
// migration boundary; see utils/auditVerifier.
//
// Run (from backend/):
//   npm run migrate:audit-sequence
//
// Idempotent. Safe to run repeatedly; a second run reports a skip.
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID } from '../lib/appwrite';
import { classifyAttributeFailure, attributeExists } from './lib/migrationErrors';

const COLLECTION = 'audit_logs_v2';
const ATTRIBUTE = 'sequence';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`[..] ensuring ${COLLECTION}.${ATTRIBUTE}`);

  // The collection must already exist. Creating it here would hide a much larger
  // problem — an install with no audit ledger at all — behind a migration that
  // reports success.
  try {
    await databases.getCollection(DB_ID, COLLECTION);
  } catch (err) {
    console.error(
      `[ERR] collection '${COLLECTION}' does not exist or is unreachable. ` +
      'This script migrates an existing ledger; it does not create one. ' +
      `Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  if (await attributeExists(databases, DB_ID, COLLECTION, ATTRIBUTE)) {
    console.log(`[=] ${ATTRIBUTE} already present — nothing to do`);
    return;
  }

  try {
    // Optional, and deliberately without a min/max. Required would reject every
    // legacy row; a min constraint adds a way for this to fail on an existing
    // collection while buying nothing, since the value is a non-negative integer
    // by construction in logSecureAuditEvent.
    await databases.createIntegerAttribute(DB_ID, COLLECTION, ATTRIBUTE, false);
    console.log(`[+] ${ATTRIBUTE} created — waiting for Appwrite to make it available`);

    // Appwrite provisions attributes asynchronously. Returning before it is
    // queryable would let a deploy start writing against an attribute that is not
    // ready yet, and the resulting rejection would look like a code fault.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (!(await attributeExists(databases, DB_ID, COLLECTION, ATTRIBUTE))) {
      console.error(
        `[ERR] ${ATTRIBUTE} was accepted but is not visible after 3s. ` +
        'Do NOT promote a build that depends on it; re-run and check the Appwrite console.',
      );
      process.exit(1);
    }
    console.log(`[ok] ${ATTRIBUTE} is present and queryable`);
  } catch (err) {
    // Deliberately not a message/code check. Appwrite validates the collection's
    // row-size budget before checking for a duplicate, so a re-create can surface
    // as "maximum number or size of attributes has been reached" rather than a
    // conflict — see lib/migrationErrors. Resolve against reality instead.
    const verdict = await classifyAttributeFailure(databases, DB_ID, COLLECTION, ATTRIBUTE, err);

    if (verdict === 'skip') {
      console.log(`[=] ${ATTRIBUTE} already present — create was redundant`);
      return;
    }

    // Print the raw shape. This is the one place an operator can observe what a
    // real Appwrite actually returns here, and ensureSequenceAttribute's behaviour
    // depends on that answer.
    const e = err as { code?: number; type?: string; message?: string };
    console.error(`[ERR] could not create ${ATTRIBUTE}: code=${e.code} type=${e.type} message=${e.message}`);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
