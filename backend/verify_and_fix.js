import { Client, Databases, Query } from 'node-appwrite';
import 'dotenv/config';

const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID || '')
    .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID || '';
const COLLECTIONS = {
    SCANS: 'scans',
    VULNERABILITIES: 'vulnerabilities'
};

async function run() {
    console.log('[Verify] Starting database verification...');
    
    // 1. Detect and fix stuck "running" scans
    console.log('[Verify] Checking for stuck scans...');
    const stuckScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.equal('status', 'running'),
        Query.limit(100)
    ]);

    for (const scan of stuckScans.documents) {
        let isStuck = false;
        if (scan.startedAt) {
            const startStr = scan.startedAt;
            // if more than 30 mins running, mark failed
            if (Date.now() - new Date(startStr).getTime() > 30 * 60000) {
                isStuck = true;
            }
        } else {
             // no startedAt, definitely broken
             isStuck = true;
        }

        if (isStuck) {
            console.log(`[Verify] Fixing stuck scan: ${scan.$id}`);
            await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, {
                status: 'failed',
                completedAt: new Date().toISOString()
            });
        }
    }

    // 2. Validate Vulnerabilities
    console.log('[Verify] Checking for orphaned or malformed vulnerabilities...');
    const vulns = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.limit(1000)
    ]);

    for (const vuln of vulns.documents) {
        if (!vuln.scanId || !vuln.repo_id) {
             console.log(`[Verify] Deleting orphaned/malformed vulnerability: ${vuln.$id}`);
             await databases.deleteDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vuln.$id);
        }
    }

    console.log('[Verify] Database verification complete.');
}

run().catch(console.error);
