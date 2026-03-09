import 'dotenv/config';
import { databases, COLLECTIONS, DB_ID, ID, Query } from './src/lib/appwrite';
import { triggerScan } from './src/services/scanService';
import * as path from 'path';

async function testPhase6() {
    const repoPath = path.resolve(process.cwd(), 'test-repo');
    console.log('🚀 Phase 6: Testing Database Write for repo at:', repoPath);

    try {
        // 1. Create a dummy repository record
        console.log('--- Step 1: Creating Dummy Repo ---');
        const repo = await databases.createDocument(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            ID.unique(),
            {
                name: 'E2E Test Repo',
                url: repoPath, // This will be used as targetPath
                user_id: 'test-user-' + Date.now(),
                visibility: 'private',
                created_at: new Date().toISOString()
            }
        );
        console.log('Created Repo:', repo.$id);

        // 2. Trigger Scan
        console.log('\n--- Step 2: Triggering Scan ---');
        const { scanId, error } = await triggerScan(repo.$id);
        if (error) throw new Error(error);
        console.log('Scan Started:', scanId);

        // 3. Poll for completion (or just wait a bit since it is async internally)
        console.log('\n--- Step 3: Waiting for scan completion (polling) ---');
        let completed = false;
        let attempts = 0;
        while (!completed && attempts < 10) {
            attempts++;
            await new Promise(r => setTimeout(r, 2000));
            const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId!);
            console.log(`Attempt ${attempts}: Status = ${scan.status}`);
            if (scan.status === 'completed' || scan.status === 'failed') {
                completed = true;
                if (scan.status === 'failed') {
                    console.error('Scan Failed Details:', scan.details);
                }
            }
        }

        // 4. Verify Vulnerabilities in Database
        console.log('\n--- Step 4: Verifying Findings in Appwrite ---');
        const vulns = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.VULNERABILITIES,
            [Query.equal('repo_id', repo.$id)]
        );

        console.log(`Total findings saved in Appwrite: ${vulns.total}`);
        vulns.documents.forEach((v: any, i: number) => {
            console.log(`[${i + 1}] ${v.tool.toUpperCase()} - ${v.severity.toUpperCase()}: ${v.message}`);
        });

        if (vulns.total >= 2) {
            console.log('\n✅ Phase 6 Successful: Findings are persisted in Appwrite!');
        } else {
            console.warn('\n⚠️ Phase 6 Partial: Expected at least 2 findings (Semgrep & Gitleaks), got', vulns.total);
        }

    } catch (e: any) {
        console.error('\n❌ Phase 6 Failed:', e.message);
    }
}

testPhase6();
