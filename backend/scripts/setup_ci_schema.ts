import { Client, Databases } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const client = new Client()
  .setEndpoint(process.env.VITE_APPWRITE_ENDPOINT || process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.VITE_APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT_ID || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

async function ensureCollection(id: string, name: string) {
  try {
    await databases.getCollection(DB_ID, id);
    console.log(`[INFO] Collection "${name}" already exists.`);
  } catch {
    console.log(`[INFO] Creating collection "${name}"...`);
    await databases.createCollection(DB_ID, id, name, []);
    console.log(`[SUCCESS] Collection "${name}" created.`);
  }
}

async function main() {
  await ensureCollection('pipelines', 'Pipelines');
  await ensureCollection('environments', 'Environments');
}

main().catch(err => {
  console.error('Setup error:', err);
  process.exit(1);
});
