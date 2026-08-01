// backend/src/scripts/migrate_autotune_collections.ts
//
// Provisions `autotune_proposals` — the ONLY thing the auto-tune engine writes.
//
// The engine never touches gate_rules. It writes a proposal row; a human
// approves it; the apply path re-checks and writes the rule. An engine that
// mutates a control unsupervised turns one false-positive telemetry spike into
// a pipeline that blocks every deploy nobody authorised it to block.
//
// v1 scope, locked in Phase 1:
//   - user-scoped gate rules only. The 'system' gate config that k8sAdmission
//     and driftMonitor read is cluster-wide and has no admin authorization
//     tier yet, so it is out of scope entirely.
//   - tighten-only. See autotune/tighten.ts.
//   - SLA thresholds are NOT tunable: SLA_HOURS is a compile-time constant in
//     shared/sla.ts, not data. Making it tunable is its own project.
//
// Run (from backend/):
//   npm run build && node dist/backend/src/scripts/migrate_autotune_collections.js
//
// Idempotent: existing collection, attributes and indexes are skipped.
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { DatabasesIndexType } from 'node-appwrite';
import { databases, DB_ID } from '../lib/appwrite';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

const COLLECTION = 'autotune_proposals';

type Attr =
  | { kind: 'string'; key: string; size: number; required: boolean }
  | { kind: 'float'; key: string; required: boolean }
  | { kind: 'boolean'; key: string; required: boolean };

const ATTRIBUTES: Attr[] = [
  // Ownership. v1 is user-scoped, so this is both the tenancy boundary and the
  // gate config the proposal targets (gateRulesRepository is keyed by user).
  { kind: 'string', key: 'user_id', size: 64, required: true },

  // open | approved | rejected | stale | expired
  { kind: 'string', key: 'status', size: 16, required: true },

  // What is being changed. target_kind is fixed at 'gate_rule' in v1 but is
  // stored so a second tunable does not need a schema change to be told apart.
  { kind: 'string', key: 'target_kind', size: 32, required: true },
  { kind: 'string', key: 'target_id', size: 64, required: true },
  { kind: 'string', key: 'field', size: 32, required: true },

  // Values are number | 'warn' | 'block' | boolean, so they are stored as text
  // and parsed against `field`. A typed column per kind would be three columns
  // and a branch on every read for no gain at this size.
  { kind: 'string', key: 'current_value', size: 32, required: true },
  { kind: 'string', key: 'proposed_value', size: 32, required: true },

  // Human-readable justification, seeded from escapeRecommendations.
  { kind: 'string', key: 'rationale', size: 4096, required: true },

  // THE EVIDENCE CONTRACT.
  //
  // Not a hash. A hash over the finding set changes whenever any unrelated
  // finding arrives, so every open proposal would invalidate within minutes and
  // the queue would always be empty.
  //
  // Instead: a re-runnable query descriptor plus the metric value that
  // justified the proposal and the threshold it had to cross. At approval time
  // the query re-runs, the metric is recomputed, and the proposal is refused if
  // it no longer crosses. That surfaces a resolved spike as a visible delta
  // ("was 62%, now 11%") rather than a silent rubber-stamp.
  { kind: 'string', key: 'metric_key', size: 128, required: true },
  { kind: 'float', key: 'metric_value', required: true },
  { kind: 'float', key: 'metric_threshold', required: true },
  { kind: 'string', key: 'evidence_query', size: 4096, required: true },

  { kind: 'string', key: 'created_at', size: 64, required: true },
  // An old queue is an unread queue: a proposal nobody acted on closes itself.
  { kind: 'string', key: 'expires_at', size: 64, required: true },

  // Audit. SOC2: a control change with no record of who authorised it is
  // unauditable. decided_* stay empty while the proposal is open.
  { kind: 'string', key: 'decided_by', size: 64, required: false },
  { kind: 'string', key: 'decided_at', size: 64, required: false },
  { kind: 'string', key: 'decision_note', size: 2048, required: false },
  // The metric recomputed at decision time, so the record shows what the
  // approver actually saw rather than what the proposer once saw.
  { kind: 'float', key: 'metric_at_decision', required: false },
];

const INDEXES: { key: string; attributes: string[] }[] = [
  // The queue: "my open proposals".
  { key: 'user_status_idx', attributes: ['user_id', 'status'] },
  // The expiry sweep.
  { key: 'status_expires_idx', attributes: ['status', 'expires_at'] },
  // Dedupe lookup: does an open proposal already exist for this rule+field?
  // Deliberately NOT a unique index — status changes over a proposal's life, so
  // a unique constraint including it would collide on the second approval for
  // the same target. The engine checks before creating instead.
  // ponytail: check-then-create can race into a duplicate proposal; the engine
  // runs on a schedule, not concurrently, and the cost is a redundant review
  // rather than a wrong control. Add a lock if it ever runs in parallel.
  { key: 'target_idx', attributes: ['user_id', 'target_id', 'field'] },
];

const already = (raw: unknown): boolean => {
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForAttributes(keys: string[], timeoutMs = 90000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(keys);
  while (Date.now() < deadline) {
    const list = await databases.listAttributes(DB_ID, COLLECTION);
    const status = new Map(list.attributes.map((a) => [(a as { key: string }).key, (a as { status?: string }).status]));
    for (const key of [...pending]) {
      const s = status.get(key);
      if (s === 'available') pending.delete(key);
      else if (s === 'failed') {
        console.error(`  [ERR]  attribute "${key}" is in 'failed' state; delete and recreate it`);
        pending.delete(key);
      }
    }
    if (pending.size === 0) return;
    await sleep(2000);
  }
  console.warn(`  [WARN] attributes not available after ${timeoutMs}ms: ${[...pending].join(', ')} — indexes may fail`);
}

async function run(): Promise<void> {
  console.log(`Ensuring collection "${COLLECTION}"...`);
  try {
    // Empty permissions, documentSecurity off. A proposal names a security
    // control and the evidence behind it; the browser reads it through the API,
    // which authorizes, and never through the collection directly.
    await databases.createCollection(DB_ID, COLLECTION, 'Auto-tune Proposals', [], false);
    console.log('  [OK]   collection created');
  } catch (raw) {
    if (already(raw)) console.log('  [SKIP] collection already exists');
    else { console.error(`  [ERR]  collection: ${(raw as Error).message}`); process.exit(1); }
  }

  await sleep(1500);

  for (const a of ATTRIBUTES) {
    try {
      if (a.kind === 'string') await databases.createStringAttribute(DB_ID, COLLECTION, a.key, a.size, a.required);
      else if (a.kind === 'float') await databases.createFloatAttribute(DB_ID, COLLECTION, a.key, a.required);
      else await databases.createBooleanAttribute(DB_ID, COLLECTION, a.key, a.required);
      console.log(`  [OK]   attribute "${a.key}"`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] attribute "${a.key}" already exists`);
      else console.error(`  [ERR]  attribute "${a.key}": ${(raw as Error).message}`);
    }
  }

  await waitForAttributes([...new Set(INDEXES.flatMap((i) => i.attributes))]);

  for (const idx of INDEXES) {
    try {
      await databases.createIndex(DB_ID, COLLECTION, idx.key, DatabasesIndexType.Key, idx.attributes);
      console.log(`  [OK]   index "${idx.key}"`);
    } catch (raw) {
      if (already(raw)) console.log(`  [SKIP] index "${idx.key}" already exists`);
      else console.error(`  [ERR]  index "${idx.key}": ${(raw as Error).message}`);
    }
  }

  console.log('\nDone. autotune_proposals is provisioned.');
  console.log('No backfill: there is nothing to migrate, and the engine writes proposals only when it runs.');
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
