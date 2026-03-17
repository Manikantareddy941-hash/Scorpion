import 'dotenv/config';
import { databases, DB_ID, COLLECTIONS } from './lib/appwrite';

async function findUser() {
    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, []);

        if (response.total === 0) {
            console.log('No users found in repositories collection. Checking tasks...');
            const tasksRes = await databases.listDocuments(DB_ID, COLLECTIONS.TASKS, []);
            if (tasksRes.total > 0) {
                console.log('USER_ID:', tasksRes.documents[0].user_id);
            } else {
                console.log('No user IDs found. Please provide a valid ID from your Appwrite users dashboard.');
            }
        } else {
            console.log('USER_ID:', response.documents[0].user_id);
        }
    } catch (err: any) {
        console.error('Error finding user:', err.message);
    }
}

findUser();
