import { zapService } from '../services/zapService';
import { ingestVulnerabilitiesDelta } from '../services/scanService';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { logger } from '../services/logger';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export interface ZapWorkerPayload {
    targetUrl: string;
    scanMode: 'spider' | 'active' | 'passive';
    scanId: string;
    userId: string;
}

const mapSeverity = (zapRisk: string): string => {
    switch (zapRisk?.toLowerCase()) {
        case 'high': return 'HIGH';
        case 'medium': return 'MEDIUM';
        case 'low': return 'LOW';
        case 'informational':
        default: return 'INFO';
    }
};

export const runZapScan = async (payload: ZapWorkerPayload) => {
    const { targetUrl, scanMode, scanId, userId } = payload;
    
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

        if (scanMode === 'passive') {
            await zapService.setPassiveScanEnabled(true);
            // Passive scan mode typically implies we spider the app to generate traffic.
        }

        // Spidering is prerequisite for active scanning as well, to discover URLs
        logger.info(`[ZAP Worker] Initiating Spider for ${targetUrl}`);
        const spiderId = await zapService.startSpider(targetUrl);
        
        let spiderStatus = 0;
        while (spiderStatus < 100) {
            await delay(5000);
            spiderStatus = await zapService.getSpiderStatus(spiderId);
            logger.info(`[ZAP Worker] Spider progress: ${spiderStatus}%`);
        }

        if (scanMode === 'active') {
            logger.info(`[ZAP Worker] Initiating Active Scan for ${targetUrl}`);
            const ascanId = await zapService.startActiveScan(targetUrl);
            
            let ascanStatus = 0;
            while (ascanStatus < 100) {
                await delay(5000);
                ascanStatus = await zapService.getActiveScanStatus(ascanId);
                logger.info(`[ZAP Worker] Active Scan progress: ${ascanStatus}%`);
            }
        }

        // Wait a brief moment for passive scanners to finish analyzing spider traffic
        await delay(5000);

        logger.info(`[ZAP Worker] Fetching alerts for ${targetUrl}`);
        const alerts = await zapService.getAlerts(targetUrl);

        logger.info(`[ZAP Worker] Found ${alerts.length} alerts.`);
        
        // Normalize findings
        const findings = alerts.map((alert: any) => ({
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

    } catch (error: any) {
        logger.error(`[ZAP Worker] Scan failed: ${error.message}`);
        
        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({ error: error.message })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_FAILED',
            'dast',
            `DAST ${scanMode} scan failed for ${targetUrl}: ${error.message}`
        );
    }
};
