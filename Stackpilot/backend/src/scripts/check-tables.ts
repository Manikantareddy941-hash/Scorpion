import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import 'dotenv/config';

async function checkTables() {
    try {
        // Check for repositories
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.limit(1)]);
        console.log('Repositories found:', repos.total);

        // Check for tasks
        const tasks = await databases.listDocuments(DB_ID, COLLECTIONS.TASKS, [Query.limit(1)]);
        console.log('Tasks found:', tasks.total);
    } catch (error) {
        console.error('Error checking Appwrite collections:', error);
    }
}

checkTables();
