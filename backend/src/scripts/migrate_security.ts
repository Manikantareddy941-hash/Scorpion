// backend/src/scripts/migrate_security.ts
import { Client, Databases } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'default';
const COLLECTION_ID = 'vulnerabilities';

async function run() {
  try {
    await databases.createCollection(DATABASE_ID, COLLECTION_ID, 'Security Vulnerabilities');
    console.log('Collection created.');
  } catch (err: any) {
    if (err.code !== 409) process.exit(1);
  }

  const attrs = [
    { key: 'runId', type: 'string', size: 255, required: true },
    { key: 'source', type: 'string', size: 50, required: true }, // 'trivy' or 'gitleaks'
    { key: 'severity', type: 'string', size: 50, required: true }, // 'CRITICAL', 'HIGH', etc.
    { key: 'title', type: 'string', size: 255, required: true },
    { key: 'package', type: 'string', size: 255, required: false },
    { key: 'description', type: 'string', size: 4096, required: false }
  ];

  for (const attr of attrs) {
    try {
      if (attr.type === 'string') {
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, attr.key, attr.size, attr.required);
      }
      console.log(`Attribute ${attr.key} verified.`);
    } catch (e) {}
  }
}
run();
