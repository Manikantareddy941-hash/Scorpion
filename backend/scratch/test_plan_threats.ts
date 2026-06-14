import { Client, Databases } from 'node-appwrite';
import path from 'path';

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';

async function test() {
  try {
    const list = await databases.listDocuments(DB_ID, 'plan_threats');
    console.log("Success! Documents:", list.total);
  } catch (err: any) {
    console.error("Failed:", err.message);
  }
}

test();
