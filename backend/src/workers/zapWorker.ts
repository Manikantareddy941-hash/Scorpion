import { zapService } from '../services/zapService';
import { logger } from '../services/logger';
import { runDastWorker, mapDastSeverity, DastWorkerPayload } from './dastWorkerRunner';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const POLL_INTERVAL_MS = 5000;
// ponytail: hard ceiling so a hung/unreachable ZAP can't wedge the worker
// forever. Bump per-scan via ZAP_POLL_TIMEOUT_MS if large targets time out.
const POLL_TIMEOUT_MS = Number(process.env.ZAP_POLL_TIMEOUT_MS) || 10 * 60 * 1000;

export interface ZapWorkerPayload extends DastWorkerPayload {
    scanMode: 'spider' | 'active' | 'passive';
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
        const raw = await getStatus();
        // A malformed/missing ZAP status parses to NaN; `NaN < 100` is false, so
        // without this guard the loop would exit and report the scan "complete"
        // with 0 findings. Treat non-numeric as no-progress and let the deadline
        // fail the scan rather than silently under-reporting.
        status = Number.isFinite(raw) ? raw : status;
        logger.info(`[ZAP Worker] ${label} progress: ${status}%`);
    }
};

export const runZapScan = async (payload: ZapWorkerPayload) => {
    const { targetUrl, scanMode, scanId, auth } = payload;
    const bearerRuleName = `scorpion-auth-${scanId}`;
    const hasBearer = !!auth?.bearerToken;

    await runDastWorker({
        tool: 'zap',
        label: 'ZAP Worker',
        payload,
        detailsExtra: () => ({ mode: scanMode }),
        run: async () => {
            try {
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
                const alerts = await zapService.getAlerts(targetUrl) as ZapAlert[];

                return alerts.map((alert) => ({
                    type: 'dast',
                    tool: 'zap',
                    severity: mapDastSeverity(alert.risk),
                    title: alert.alert,
                    description: alert.description,
                    filePath: alert.url || targetUrl,
                    confidence: alert.confidence,
                    solution: alert.solution,
                    cveId: alert.cweid ? `CWE-${alert.cweid}` : '',
                    status: 'open',
                    detected_at: new Date().toISOString()
                }));
            } finally {
                if (hasBearer) {
                    await zapService.removeBearerToken(bearerRuleName);
                }
            }
        }
    });
};
