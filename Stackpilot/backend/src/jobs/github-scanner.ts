import { databases, COLLECTIONS, DB_ID, Query } from '../lib/appwrite';
import { triggerScan } from '../services/scanService';

export const scanRepositories = async () => {
    console.log('[Scanner] Starting repository scan cycle...');

    try {
        // 1. Fetch repositories that haven't been scanned in 24h
        // (Rate limiting cooldown is also handled inside triggerScan)
        const response = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [
                Query.orderAsc('last_scan_at'),
                Query.limit(5)
            ]
        );

        const repos = response.documents;

        if (repos.length === 0) {
            console.log('[Scanner] No repositories pending scan.');
            return;
        }

        // 2. Trigger scan for each repo using service
        for (const repo of repos) {
            console.log(`[Scanner] Triggering scan for ${repo.url}...`);
            const { error: scanError } = await triggerScan(repo.$id);

            if (scanError) {
                console.error(`[Scanner] Failed to scan ${repo.url}: ${scanError}`);
            } else {
                console.log(`[Scanner] Successfully finished scan for ${repo.url}`);
            }
        }
    } catch (error) {
        console.error('[Scanner] Error during repository scan cycle:', error);
    }
};
