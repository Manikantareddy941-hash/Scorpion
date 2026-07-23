import { Permission, Role } from 'node-appwrite';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { ingestVulnerabilitiesDelta } from '../services/scanService';
import { logger } from '../services/logger';
import { IngestableIssue } from '../types/scan.types';

// Shared severity vocabulary across DAST tools. ZAP never reports 'critical'
// (its risk scale tops out at High), but routing it through the same mapper
// as Nuclei costs nothing and keeps one source of truth instead of two
// near-identical switch statements drifting apart.
export const mapDastSeverity = (severity: string | undefined): string => {
    switch (severity?.toLowerCase()) {
        case 'critical': return 'CRITICAL';
        case 'high': return 'HIGH';
        case 'medium': return 'MEDIUM';
        case 'low': return 'LOW';
        case 'informational':
        case 'info':
        case 'unknown':
        default: return 'INFO';
    }
};

export interface DastWorkerPayload {
    targetUrl: string;
    scanId: string;
    userId: string;
}

export interface DastWorkerOptions<TPayload extends DastWorkerPayload> {
    /** Short lowercase identifier stored on each finding and used in the audit trail, e.g. 'zap'. */
    tool: string;
    /** Console log prefix, e.g. 'ZAP Worker'. */
    label: string;
    payload: TPayload;
    /** Runs the scan and returns normalized findings. Any tool-specific setup/teardown belongs here. */
    run: () => Promise<IngestableIssue[]>;
    /** Extra fields merged into the scan document's `details` JSON on success. */
    detailsExtra?: (findings: IngestableIssue[]) => Record<string, unknown>;
}

/**
 * Shared lifecycle envelope for every DAST worker (ZAP/Nuclei/ffuf): audit
 * STARTED -> status running -> run() -> ingest delta -> status completed ->
 * audit COMPLETED, with a catch that marks the scan failed, audits FAILED,
 * and rethrows so BullMQ's retry policy sees the failure.
 */
export async function runDastWorker<TPayload extends DastWorkerPayload>(
    opts: DastWorkerOptions<TPayload>
): Promise<void> {
    const { tool, label, payload, run, detailsExtra } = opts;
    const { targetUrl, scanId, userId } = payload;

    try {
        logger.info(`[${label}] Starting scan for ${targetUrl} (Scan ID: ${scanId})`);

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_STARTED',
            'dast',
            `DAST ${tool} scan started against ${targetUrl}`
        );

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, { status: 'running' });

        const findings = await run();
        logger.info(`[${label}] Found ${findings.length} findings.`);

        // Grant document read to the user who triggered the scan. The
        // vulnerabilities collection is sealed, so without this a DAST finding
        // is invisible to its owner's browser and realtime never delivers it —
        // the same gap fixed for repo scans. Does not address the shared 'dast'
        // repo_id (see the delta's ponytail note); it only makes the finding
        // reachable by the person who ran it.
        const ownerDocPerms = userId ? [Permission.read(Role.user(userId))] : [];
        await ingestVulnerabilitiesDelta('dast', scanId, findings, [tool], ownerDocPerms);

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({
                target: targetUrl,
                total_vulnerabilities: findings.length,
                ...(detailsExtra ? detailsExtra(findings) : {})
            })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_COMPLETED',
            'dast',
            `DAST ${tool} scan completed for ${targetUrl}. Found ${findings.length} issues.`
        );

        logger.info(`[${label}] Scan ${scanId} completed successfully.`);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[${label}] Scan failed: ${message}`);

        await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            details: JSON.stringify({ error: message })
        });

        await logSecureAuditEvent(
            userId || 'system',
            'DAST_SCAN_FAILED',
            'dast',
            `DAST ${tool} scan failed for ${targetUrl}: ${message}`
        );

        // Rethrow so BullMQ registers the failure and retries per the queue's
        // attempts policy. The scan record is already marked failed above.
        throw error;
    }
}
