import 'dotenv/config';
import { databases, DB_ID, COLLECTIONS, Query } from './lib/appwrite';

async function findUser() {
    try {
        // Find a user ID from repositories
        const repos = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.limit(1)]
        );

        if (repos.total > 0) {
            console.log('USER_ID:', repos.documents[0].user_id);
        } else {
            console.log('No user IDs found in repositories. Checking tasks...');
            const tasks = await databases.listDocuments(
                DB_ID,
                COLLECTIONS.TASKS,
                [Query.limit(1)]
            );
            if (tasks.total > 0) {
                console.log('USER_ID:', tasks.documents[0].user_id);
            } else {
                console.log('No user IDs found. Please provide a valid Appwrite User ID.');
            }
        }
    } catch (error) {
        console.error('Error finding user ID:', error);
    }
}

findUser();
