// backend/src/scripts/migrate_environments.ts
import { Client, Databases } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);

// Constants – adjust if your DB ID differs
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'default';
const COLLECTION_ID = 'environments';

async function runMigration() {
  console.log(`[Migration] Initializing target database cluster context: "${DATABASE_ID}"...`);

  try {
    // 1. Establish the collection master node
    await databases.createCollection(DATABASE_ID, COLLECTION_ID, 'Target Infrastructure Environments');
    console.log(`[Migration] Collection "${COLLECTION_ID}" established successfully.`);
  } catch (err: any) {
    if (err.code === 409) {
      console.log(`[Migration] Collection "${COLLECTION_ID}" already exists. Syncing structural attributes...`);
    } else {
      console.error(`[Migration Fatal] Collection creation failed:`, err);
      process.exit(1);
    }
  }

  // 2. Blueprint schemas for the destination targets
  const attributes = [
    { key: 'name', type: 'string', size: 255, required: true },
    { key: 'host', type: 'string', size: 255, required: true },
    { key: 'port', type: 'integer', size: 0, required: true },
    { key: 'username', type: 'string', size: 255, required: true },
    { key: 'privateKey', type: 'string', size: 16384, required: true },
    { key: 'deployPath', type: 'string', size: 2048, required: true }
  ];

  for (const attr of attributes) {
    try {
      if (attr.type === 'string') {
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, attr.key, attr.size, attr.required);
      } else if (attr.type === 'integer') {
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTION_ID, attr.key, attr.required);
      }
      console.log(`   └─ Created attribute: [${attr.type.toUpperCase()}] -> ${attr.key}`);
    } catch (attrErr: any) {
      if (attrErr.code === 409) {
        console.log(`   └─ Attribute "${attr.key}" verified. Skipping.`);
      } else {
        console.error(`   └─ Error creating attribute "${attr.key}":`, attrErr.message);
      }
    }
  }

  console.log(`[Migration] Schema synchronization resolved successfully.`);
}

runMigration();
