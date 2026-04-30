import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

process.env.APPWRITE_PROJECT_ID = process.env.VITE_APPWRITE_PROJECT_ID;
process.env.APPWRITE_DATABASE_ID = process.env.VITE_APPWRITE_DATABASE_ID;
process.env.APPWRITE_ENDPOINT = process.env.VITE_APPWRITE_ENDPOINT;

import { databases, DB_ID, COLLECTIONS, Query } from './src/lib/appwrite';

async function cleanMockData() {
    console.log('[CLEAN] Starting cleanup of mock test vulnerabilities...');
    try {
        if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
        
        // Fetch vulnerabilities iteratively
        let mockFound = 0;
        let offset = 0;
        const batchSize = 100;
        
        while (true) {
            const vulns = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.limit(batchSize),
                Query.offset(offset)
            ]);
            
            if (vulns.documents.length === 0) break;
            
            for (const doc of vulns.documents) {
                const isMock = 
                    (doc.message && doc.message.includes('CVE-TEST')) ||
                    (doc.message && doc.message.includes('MOCK')) ||
                    (doc.title && doc.title.includes('MOCK')) ||
                    (doc.package && doc.package.includes('mock'));
                    
                if (isMock) {
                    console.log(`[CLEAN] Destroying mock vulnerability: ${doc.$id}`);
                    await databases.deleteDocument(DB_ID, COLLECTIONS.VULNERABILITIES, doc.$id);
                    mockFound++;
                }
            }
            
            offset += batchSize;
        }
        
        console.log(`[CLEAN] Cleanup sweep complete. Destroyed ${mockFound} mock tracker elements from the physical database.`);
        process.exit(0);
    } catch (err) {
        console.error(`[CLEAN] Cleanup Error:`, err);
        process.exit(1);
    }
}

cleanMockData();
