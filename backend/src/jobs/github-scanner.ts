import { triggerScan } from '../services/scanService';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';

export const scanRepositories = async () => {
    logger.info('[Scanner] Starting repository scan cycle...');

    try {
        // 1. Fetch repositories that haven't been scanned in 24h
        // (Rate limiting cooldown is also handled inside triggerScan)
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.orderAsc('last_scan_at'),
            Query.limit(5)
        ]);

        const repos = response.documents;

        if (repos.length === 0) {
            logger.info('[Scanner] No repositories pending scan.');
            return;
        }

        // 2. Trigger scan for each repo using service
        for (const repo of repos) {
            logger.info(`[Scanner] Triggering scan for ${repo.url}...`);
            const { error: scanError } = await triggerScan(repo.$id);

            if (scanError) {
                logger.error(`[Scanner] Failed to scan ${repo.url}: ${scanError}`);
            } else {
                logger.info(`[Scanner] Successfully finished scan for ${repo.url}`);
            }
        }
    } catch (error) {
        logger.error('[Scanner] Error in repository scan cycle:', { event: 'GITHUB_SCAN_CYCLE_FAILED', ...errorContext(error) });
    }
};
