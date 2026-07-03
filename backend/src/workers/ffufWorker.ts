import { runFfuf, FfufResult } from '../services/ffufService';
import { ingestVulnerabilitiesDelta } from '../services/scanService';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { logger } from '../services/logger';

export interface FfufWorkerPayload {
    targetUrl: string;
    rate?: number;
    scanId: string;
    userId: string;
}

export const runFfufScan = async (payload: FfufWorkerPayload) => {
    const { targetUrl, rate, scanId, userId } = payload;

    try {
        logger.info(`[ffuf Worker] Starting fuzz for ${targetUrl} (Scan ID: ${scanId})`);

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_STARTED',
            'dast',
            `ffuf content-discovery fuzz started against ${targetUrl}`
        );

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'running'
        });

        const results = await runFfuf(targetUrl, { rate });
        logger.info(`[ffuf Worker] Found ${results.length} responsive paths.`);

        // A discovered endpoint is attack surface, not inherently a vulnerability,
        // so everything maps to INFO. The gate treats INFO as non-blocking.
        const findings = results.map((r: FfufResult) => ({
            type: 'dast',
            tool: 'ffuf',
            severity: 'INFO',
            title: `Discovered endpoint: /${r.input?.FUZZ ?? ''}`,
            description: `ffuf received HTTP ${r.status} (length ${r.length}) at ${r.url}`,
            filePath: r.url || targetUrl,
            status: 'open',
            detected_at: new Date().toISOString()
        }));

        await ingestVulnerabilitiesDelta('dast', scanId, findings);

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({
                target: targetUrl,
                total_paths: findings.length
            })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_COMPLETED',
            'dast',
            `ffuf fuzz completed for ${targetUrl}. Found ${findings.length} paths.`
        );

        logger.info(`[ffuf Worker] Scan ${scanId} completed successfully.`);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[ffuf Worker] Scan failed: ${message}`);

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({ error: message })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_FAILED',
            'dast',
            `ffuf fuzz failed for ${targetUrl}: ${message}`
        );

        // Rethrow so BullMQ registers the failure and retries per queue policy.
        throw error;
    }
};
