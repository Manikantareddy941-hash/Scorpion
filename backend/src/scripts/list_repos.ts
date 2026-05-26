import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';

async function run() {
  try {
    const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES);
    console.log('Repositories count:', repos.total);
    for (const r of repos.documents) {
      console.log(`- ID: ${r.$id}, Name: ${r.name}, URL: ${r.url}, local_path: ${r.local_path}`);
    }
  } catch (err: any) {
    console.error('Error listing repos:', err.message);
  }
}

run();
