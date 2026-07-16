// Adds threat-intel enrichment attributes (EPSS + CISA KEV + combined risk
// score) to the vulnerabilities collection. Idempotent: existing attributes
// are left untouched. Run with:
//   npx ts-node src/scripts/migrate_enrichment.ts
import 'dotenv/config';
import { Client, Databases } from 'node-appwrite';

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'default';
const COLLECTION_ID = 'vulnerabilities';

async function run() {
  const attrs: Array<() => Promise<unknown>> = [
    () => databases.createFloatAttribute(DATABASE_ID, COLLECTION_ID, 'epss_score', false),
    () => databases.createFloatAttribute(DATABASE_ID, COLLECTION_ID, 'epss_percentile', false),
    () => databases.createBooleanAttribute(DATABASE_ID, COLLECTION_ID, 'kev', false),
    () => databases.createIntegerAttribute(DATABASE_ID, COLLECTION_ID, 'risk_score', false)
  ];

  for (const create of attrs) {
    try {
      await create();
      console.log('Attribute created.');
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 409) {
        console.log('Attribute already exists, skipping.');
      } else {
        console.error('Attribute creation failed:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    }
  }
}

run();
