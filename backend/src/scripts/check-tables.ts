import 'dotenv/config';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';

async function checkTables() {
    console.log('Checking Appwrite collections...');
    
    try {
        // Check for repositories collection
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, []);
        console.log('Repositories found:', repos.total);

        // Check for password_resets collection
        const resets = await databases.listDocuments(DB_ID, COLLECTIONS.PASSWORD_RESETS, []);
        console.log('Password resets found:', resets.total);

        // Check for other core collections
        const scans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, []);
        console.log('Scans found:', scans.total);

        const vulnerabilities = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, []);
        console.log('Vulnerabilities found:', vulnerabilities.total);

    } catch (err: any) {
        console.error('Error checking Appwrite collections:', err.message);
    }
}

checkTables();
