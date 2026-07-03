import { zapService } from '../services/zapService';
import { ingestVulnerabilitiesDelta } from '../services/scanService';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { logger } from '../services/logger';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const POLL_INTERVAL_MS = 5000;
// ponytail: hard ceiling so a hung/unreachable ZAP can't wedge the worker
// forever. Bump per-scan via ZAP_POLL_TIMEOUT_MS if large targets time out.
const POLL_TIMEOUT_MS = Number(process.env.ZAP_POLL_TIMEOUT_MS) || 10 * 60 * 1000;

export interface ZapWorkerPayload {
    targetUrl: string;
    scanMode: 'spider' | 'active' | 'passive';
    scanId: string;
    userId: string;
    auth?: { bearerToken?: string };
}

// Subset of the ZAP alert JSON we consume; ZAP returns more fields we ignore.
interface ZapAlert {
    risk?: string;
    alert?: string;
    description?: string;
    url?: string;
    confidence?: string;
    solution?: string;
    cweid?: string;
}

const mapSeverity = (zapRisk: string | undefined): string => {
    switch (zapRisk?.toLowerCase()) {
        case 'high': return 'HIGH';
        case 'medium': return 'MEDIUM';
        case 'low': return 'LOW';
        case 'informational':
        default: return 'INFO';
    }
};

/**
 * Polls a ZAP progress endpoint (0-100) until complete or the timeout fires.
 * Throws on timeout so the caller marks the scan failed instead of hanging.
 */
const waitForCompletion = async (
    getStatus: () => Promise<number>,
    label: string
): Promise<void> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let status = 0;
    while (status < 100) {
        if (Date.now() > deadline) {
            throw new Error(`${label} timed out after ${POLL_TIMEOUT_MS}ms`);
        }
        await delay(POLL_INTERVAL_MS);
        status = await getStatus();
        logger.info(`[ZAP Worker] ${label} progress: ${status}%`);
    }
};

export const runZapScan = async (payload: ZapWorkerPayload) => {
    const { targetUrl, scanMode, scanId, userId, auth } = payload;
    const bearerRuleName = `scorpion-auth-${scanId}`;
    const hasBearer = !!auth?.bearerToken;

    try {
        logger.info(`[ZAP Worker] Starting ${scanMode} scan for ${targetUrl} (Scan ID: ${scanId})`);

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_STARTED',
            'dast',
            `DAST ${scanMode} scan started against ${targetUrl}`
        );

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'running'
        });

        // Inject bearer token (if provided) so the scanner reaches
        // authenticated routes. Removed in the finally block below.
        if (hasBearer) {
            await zapService.setBearerToken(bearerRuleName, auth!.bearerToken!);
            logger.info(`[ZAP Worker] Bearer auth enabled for scan ${scanId}`);
        }

        if (scanMode === 'passive') {
            await zapService.setPassiveScanEnabled(true);
            // Passive scan mode typically implies we spider the app to generate traffic.
        }

        // Spidering is prerequisite for active scanning as well, to discover URLs
        logger.info(`[ZAP Worker] Initiating Spider for ${targetUrl}`);
        const spiderId = await zapService.startSpider(targetUrl);
        await waitForCompletion(() => zapService.getSpiderStatus(spiderId), 'Spider');

        if (scanMode === 'active') {
            logger.info(`[ZAP Worker] Initiating Active Scan for ${targetUrl}`);
            const ascanId = await zapService.startActiveScan(targetUrl);
            await waitForCompletion(() => zapService.getActiveScanStatus(ascanId), 'Active Scan');
        }

        // Wait a brief moment for passive scanners to finish analyzing spider traffic
        await delay(POLL_INTERVAL_MS);

        logger.info(`[ZAP Worker] Fetching alerts for ${targetUrl}`);
        const alerts = await zapService.getAlerts(targetUrl);

        logger.info(`[ZAP Worker] Found ${alerts.length} alerts.`);

        // Normalize findings
        const findings = (alerts as ZapAlert[]).map((alert) => ({
            type: 'dast',
            tool: 'zap',
            severity: mapSeverity(alert.risk),
            title: alert.alert,
            description: alert.description,
            filePath: alert.url || targetUrl,
            confidence: alert.confidence,
            solution: alert.solution,
            cveId: alert.cweid ? `CWE-${alert.cweid}` : '',
            status: 'open',
            detected_at: new Date().toISOString()
        }));

        // Deduplicate and ingest
        await ingestVulnerabilitiesDelta('dast', scanId, findings);

        // Update scan record
        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({
                target: targetUrl,
                mode: scanMode,
                total_vulnerabilities: findings.length,
                alerts: alerts.length
            })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_COMPLETED',
            'dast',
            `DAST ${scanMode} scan completed for ${targetUrl}. Found ${findings.length} issues.`
        );

        logger.info(`[ZAP Worker] Scan ${scanId} completed successfully.`);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[ZAP Worker] Scan failed: ${message}`);

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({ error: message })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_FAILED',
            'dast',
            `DAST ${scanMode} scan failed for ${targetUrl}: ${message}`
        );

        // Rethrow so BullMQ registers the failure and retries per the queue's
        // attempts policy. The scan record is already marked failed above.
        throw error;
    } finally {
        if (hasBearer) {
            await zapService.removeBearerToken(bearerRuleName);
        }
    }
};
