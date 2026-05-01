import dotenv from 'dotenv';
dotenv.config();
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { Query } from 'node-appwrite';

async function migrate() {
    console.log(`🚀 Starting migration. DB_ID: ${DB_ID}, Collection: ${COLLECTIONS.VULNERABILITIES}`);
    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.limit(5000)
        ]);

        console.log(`Found ${response.total} vulnerabilities. Checking for missing detected_at...`);

        let count = 0;
        for (const doc of response.documents) {
            if (!doc.detected_at) {
                await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, doc.$id, {
                    detected_at: doc.$createdAt
                });
                count++;
            }
        }

        console.log(`✅ Migration complete. Updated ${count} records.`);
    } catch (err) {
        console.error('❌ Migration failed:', err);
    }
}

migrate();
