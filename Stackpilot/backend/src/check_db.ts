import 'dotenv/config';
import { databases, DB_ID, COLLECTIONS, Query } from './lib/appwrite';

async function checkDatabase() {
    console.log('Checking Appwrite Database connectivity...');

    try {
        const response = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.limit(1)]
        );
        console.log('✅ Connectivity successful. Found repositories:', response.total);
    } catch (error: any) {
        console.error('❌ Database connectivity failed:', error.message);
    }
}

checkDatabase();
