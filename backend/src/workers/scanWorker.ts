import { resolveToolCommand } from '../utils/toolCheck';
import { logger } from '../services/logger';

// Tracks whether the startup tool-availability check has run; surfaced via
// healthRoutes.ts's /health endpoint.
export let isWorkerRunning = false;

/**
 * Startup diagnostic: logs which scan engines are available on this host.
 * Actual scan execution lives in services/scanService.ts (triggerScan),
 * run via the BullMQ queue (see ../queues/scanQueueWorker.ts).
 */
export async function initScanWorker() {
    isWorkerRunning = true;
    logger.info('🛡️  [Scan Worker] Checking scan engine availability...');

    try {
        const tools = ['semgrep', 'checkov', 'gitleaks', 'trivy', 'bandit'];

        for (const toolName of tools) {
            const tool = await resolveToolCommand(toolName);
            const displayName = toolName.charAt(0).toUpperCase() + toolName.slice(1);
            if (tool.status === 'missing') {
                logger.warn(`❌ [Scan Worker] ${displayName} NOT found`);
            } else {
                logger.info(`✅ [Scan Worker] ${displayName} detected and active`);
            }
        }
    } catch (err) {
        logger.warn('⚠️  [Scan Worker] WARN: tool check failed');
    }
}
