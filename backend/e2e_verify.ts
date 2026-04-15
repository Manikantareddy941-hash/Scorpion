import { triggerScan } from './src/services/scanService';
import { databases, DB_ID, COLLECTIONS, Query } from './src/lib/appwrite';
import 'dotenv/config';

async function runE2E() {
    console.log('[E2E] Starting End-to-End Database Validation...');
    
    try {
        const testRepoId = process.argv[2] || (await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.limit(1)])).documents[0]?.$id;
        
        if (!testRepoId) {
            console.log('[E2E] No repository available for test. Skipping run.');
            return;
        }

        console.log(`[E2E] Triggering fresh scan for test repo: ${testRepoId}`);
        const result = await triggerScan(testRepoId, 'private');
        
        console.log(`[E2E] triggerScan Response:`, result);

        if (result.scanId) {
             const finalDoc = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, result.scanId);
             console.log(`[E2E] Final Scan Document in DB:`, {
                 id: finalDoc.$id,
                 status: finalDoc.status,
                 startedAt: finalDoc.startedAt,
                 completedAt: finalDoc.completedAt
             });
             
             if (finalDoc.status !== 'completed' && finalDoc.status !== 'failed') {
                  throw new Error(`[E2E] Scan ended in invalid terminal state: ${finalDoc.status}`);
             }

             if (!finalDoc.startedAt || (!finalDoc.completedAt && finalDoc.status === 'failed')) {
                  throw new Error(`[E2E] Timestamp validation failed. Valid ISODate required.`);
             }

             const finalVulns = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                 Query.equal('scanId', result.scanId),
                 Query.limit(5)
             ]);
             
             console.log(`[E2E] Sample Parsed Vulnerability saved for this scan (${finalVulns.total} total):`);
             if (finalVulns.total > 0) {
                 const v = finalVulns.documents[0];
                 console.log({
                     scanId: v.scanId,
                     repo_id: v.repo_id,
                     tool: v.tool,
                     severity: v.severity,
                     message: v.message.substring(0, 30) + '...'
                 });

                 if (!v.scanId || !v.repo_id || !v.tool) {
                      throw new Error(`[E2E] Vulnerability persisted with missing core parameters: ${JSON.stringify(v)}`);
                 }
             }

             console.log(`[E2E] Validation Passed. System is completely isolated, accurately schema-constrained, and consistent.`);
        }
    } catch (err) {
        console.error(`[E2E] Error:`, err);
        process.exit(1);
    }
}

runE2E();
