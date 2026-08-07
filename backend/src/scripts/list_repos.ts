import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { errorMessage } from '../services/logger';

async function run() {
  try {
    const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES);
    console.log('Repositories count:', repos.total);
    for (const r of repos.documents) {
      console.log(`- ID: ${r.$id}, Name: ${r.name}, URL: ${r.url}, local_path: ${r.local_path}`);
    }
  } catch (err) {
    console.error('Error listing repos:', errorMessage(err));
  }
}

run();
