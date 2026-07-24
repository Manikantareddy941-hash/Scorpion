// backend/src/scripts/repair_wedged_attribute.cjs
//
// Generic repair for a wedged string attribute.
//
// This Appwrite instance intermittently leaves a freshly-created string
// attribute stuck in 'processing' indefinitely (observed on plan_issues.sprintId
// and plan_threats.issueId) while its siblings go 'available' in seconds. No
// wait clears it. Deleting and recreating the single attribute fixes it.
//
// Only safe on empty/non-critical attributes (the plan collections were on the
// JSON fallback, so they hold no rows worth preserving). It does NOT recreate
// indexes; pass a collection/attr that has no dependent index, or rebuild the
// index separately.
//
// Usage:
//   node src/scripts/repair_wedged_attribute.cjs <collectionId> <attrKey> [size]
// Example:
//   node src/scripts/repair_wedged_attribute.cjs plan_threats issueId 64
const { Client, Databases } = require('node-appwrite');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

const COLLECTION = process.argv[2];
const KEY = process.argv[3];
const SIZE = Number(process.argv[4] || 64);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attrStatus() {
  const list = await databases.listAttributes(DB_ID, COLLECTION);
  const a = list.attributes.find((x) => x.key === KEY);
  return a ? a.status : null; // null = absent
}

async function waitUntil(predicate, label, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await attrStatus();
    if (predicate(s)) return s;
    console.log(`  ...${label} (status=${s ?? 'absent'})`);
    await sleep(2000);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function run() {
  if (!DB_ID) { console.error('[FATAL] APPWRITE_DATABASE_ID not set'); process.exit(1); }
  if (!COLLECTION || !KEY) { console.error('Usage: node repair_wedged_attribute.cjs <collectionId> <attrKey> [size]'); process.exit(1); }

  const start = await attrStatus();
  console.log(`${COLLECTION}.${KEY} current status: ${start ?? 'absent'}`);

  if (start === 'available') {
    console.log('Already available — nothing to repair.');
    return;
  }
  if (start !== null) {
    console.log('Deleting wedged attribute...');
    await databases.deleteAttribute(DB_ID, COLLECTION, KEY);
    await waitUntil((s) => s === null, 'awaiting delete', 60000);
    console.log('  deleted.');
  }
  console.log(`Recreating ${KEY} (string, ${SIZE}, optional)...`);
  await databases.createStringAttribute(DB_ID, COLLECTION, KEY, SIZE, false, undefined, false);
  await waitUntil((s) => s === 'available', 'awaiting available', 90000);
  console.log(`[OK] ${COLLECTION}.${KEY} is available.`);
}

run().catch((e) => { console.error('[FATAL]', e.message || e); process.exit(1); });
