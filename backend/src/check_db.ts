import 'dotenv/config';
import { databases, DB_ID, COLLECTIONS } from './lib/appwrite';

async function checkAppwriteDB() {
    console.log(`Checking Appwrite Database: ${DB_ID}`);

    try {
        const collections = await databases.listCollections(DB_ID);
        console.log('Collections status: Success');
        console.log('Available collections:', collections.collections.map(c => c.name));

        // Try a simple select from repositories
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, []);
        console.log('Repositories check: Success', `(${repos.total} documents)`);
    } catch (error: any) {
        console.error('Appwrite DB check failed:', error.message);
    }
}

checkAppwriteDB();
