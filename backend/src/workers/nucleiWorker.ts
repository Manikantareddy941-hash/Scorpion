import { runNuclei, NucleiResult } from '../services/nucleiService';
import { ingestVulnerabilitiesDelta } from '../services/scanService';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { logger } from '../services/logger';

export interface NucleiWorkerPayload {
    targetUrl: string;
    tags?: string;
    scanId: string;
    userId: string;
}

const mapSeverity = (severity: string | undefined): string => {
    switch (severity?.toLowerCase()) {
        case 'critical': return 'CRITICAL';
        case 'high': return 'HIGH';
        case 'medium': return 'MEDIUM';
        case 'low': return 'LOW';
        case 'info':
        case 'unknown':
        default: return 'INFO';
    }
};

const firstCveOrCwe = (result: NucleiResult): string => {
    const cls = result.info?.classification;
    return cls?.['cve-id']?.[0] || cls?.['cwe-id']?.[0] || '';
};

export const runNucleiScan = async (payload: NucleiWorkerPayload) => {
    const { targetUrl, tags, scanId, userId } = payload;

    try {
        logger.info(`[Nuclei Worker] Starting scan for ${targetUrl} (Scan ID: ${scanId})`);

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_STARTED',
            'dast',
            `Nuclei scan started against ${targetUrl}`
        );

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'running'
        });

        const results = await runNuclei(targetUrl, tags);
        logger.info(`[Nuclei Worker] Found ${results.length} results.`);

        const findings = results.map((r) => ({
            type: 'dast',
            tool: 'nuclei',
            severity: mapSeverity(r.info?.severity),
            title: r.info?.name || r['template-id'] || 'Nuclei finding',
            description: r.info?.description || '',
            filePath: r['matched-at'] || r.host || targetUrl,
            solution: r.info?.remediation || '',
            cveId: firstCveOrCwe(r),
            status: 'open',
            detected_at: new Date().toISOString()
        }));

        await ingestVulnerabilitiesDelta('dast', scanId, findings, ['nuclei']);

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({
                target: targetUrl,
                tags: tags || null,
                total_vulnerabilities: findings.length
            })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_COMPLETED',
            'dast',
            `Nuclei scan completed for ${targetUrl}. Found ${findings.length} issues.`
        );

        logger.info(`[Nuclei Worker] Scan ${scanId} completed successfully.`);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[Nuclei Worker] Scan failed: ${message}`);

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({ error: message })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_FAILED',
            'dast',
            `Nuclei scan failed for ${targetUrl}: ${message}`
        );

        // Rethrow so BullMQ registers the failure and retries per queue policy.
        throw error;
    }
};
