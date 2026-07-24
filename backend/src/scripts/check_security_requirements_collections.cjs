// backend/src/scripts/check_security_requirements_collections.cjs
//
// Write-probe verifier for the Security Requirements collections. A list-only
// check can't see phantom attributes (available in listAttributes but rejected
// by createDocument — the #125 lesson), so this actually writes a realistic
// document to each collection, reads it back, and deletes it.
//
// Run:
//   cd backend && node src/scripts/check_security_requirements_collections.cjs
const { Client, Databases, ID } = require('node-appwrite');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';
let failures = 0;

async function probe(collection, payload) {
  try {
    const doc = await databases.createDocument(DB_ID, collection, ID.unique(), payload);
    await databases.getDocument(DB_ID, collection, doc.$id); // read-back
    await databases.deleteDocument(DB_ID, collection, doc.$id);
    console.log(`[OK]   ${collection} accepted a full write (incl. array attrs)`);
  } catch (e) {
    failures++;
    const err = e;
    console.error(`[FAIL] ${collection}: ${err.message}`);
    if (err.response) console.error(`       ${JSON.stringify(err.response)}`);
  }
}

async function run() {
  if (!DB_ID) { console.error('[FATAL] APPWRITE_DATABASE_ID not set'); process.exit(1); }
  const now = new Date().toISOString();

  await probe('plan_project_profiles', {
    projectId: 'probe-proj', appType: 'api', stack: ['node'], dataTypes: ['card'],
    deployment: 'cloud', authModel: 'session', frameworks: ['PCI DSS', 'SOC 2'], updatedAt: now,
  });

  await probe('plan_security_requirements', {
    projectId: 'probe-proj', code: 'REQ-PROBE', title: 'probe', description: 'd',
    category: 'Authentication', frameworks: ['PCI DSS', 'SOC 2'], controlIds: ['PCI DSS 8.3.1', 'CC6.1'],
    severity: 'high', status: 'required', lifecycleStatus: 'open', justification: '',
    updatedBy: 'probe@x', sourceRuleId: ['pci-mfa', 'soc2-mfa'], remediation: 'r', createdAt: now,
    ticketId: 'tk-probe', jiraKey: 'SEC-1',
  });

  console.log(`\n${failures === 0 ? 'ALL GREEN — both collections accept full writes.' : `${failures} collection(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('[FATAL]', e.message || e); process.exit(1); });
