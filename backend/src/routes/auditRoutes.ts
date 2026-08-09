import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { auditVerifyLimiter } from '../middleware/rateLimiters';
import { runFullAuditVerification, isTamperSuspected } from '../utils/auditOrchestrator';
import { logger, errorContext, errorMessage } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Get audit logs
router.get('/', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.$id || '';
        let docs: Models.DefaultDocument[] = [];
        try {
            const response = await databases.listDocuments(
                DB_ID,
                'audit_logs_v2',
                [
                    Query.equal('actor', userId),
                    Query.orderDesc('timestamp'),
                    Query.limit(100)
                ]
            );
            docs = response.documents;
        } catch (err: unknown) {
            logger.warn('[Audit API V2 Warning] audit_logs_v2 not ready, falling back to legacy', errorContext(err));
            // Fallback to legacy audit_logs
            const legacyResponse = await databases.listDocuments(
                DB_ID,
                'audit_logs',
                [
                    Query.equal('actor', userId),
                    Query.orderDesc('$createdAt'),
                    Query.limit(100)
                ]
            );
            docs = legacyResponse.documents.map((d) => ({
                ...d,
                repo_id: d.resourceId || 'system',
                tamper_hash: 'LEGACY_UNHASHED'
            }));
        }

        // Scoped to the caller's own actions, so one tenant can never read
        // another tenant's audit trail through this route.
        res.json(docs);
    } catch (err: unknown) {
        const message = errorMessage(err);
        logger.error('[Audit API Error]', { event: 'AUDIT_LIST_FAILED', ...errorContext(err) });
        res.status(500).json({ error: 'Internal server error', message });
    }
});

// Create audit log (Server-side write)
router.post('/', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        const { action, resource, details, resourceId, ipAddress } = req.body;

        // Map to exact Appwrite attributes (audit_logs collection)
        const payload = {
            actor: user?.$id || 'unknown',
            actorEmail: user?.email || 'unknown',
            action,
            resource,
            resourceId: resourceId || '',
            details: typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
            ipAddress: ipAddress || req.ip || 'unknown',
            timestamp: new Date().toISOString()
        };

        const response = await databases.createDocument(
            DB_ID,
            'audit_logs',
            ID.unique(),
            payload
        );

        res.status(201).json(response);
    } catch (err: unknown) {
        const message = errorMessage(err);
        const response_ = typeof err === 'object' && err !== null && 'response' in err ? (err as { response?: { message?: string } }).response : undefined;
        logger.error('[Audit Create Error]', {
            event: 'AUDIT_CREATE_FAILED',
            ...(response_?.message ? { upstreamMessage: response_.message } : {}),
            ...errorContext(err),
        });
        res.status(500).json({
            error: 'Failed to create audit log',
            message,
            details: response_?.message || 'Check Appwrite collection attributes'
        });
    }
});

/**
 * GET /api/audit/verify — replays the tamper-evident ledger and cross-checks it
 * against the off-box anchors.
 *
 * This is the read path the hash chain never had. Without it, tamper_hash was
 * written on every row and consulted only to chain the next one.
 *
 * GUARDS, and why each is not optional:
 *
 * - verifyUser + requireRole: the response states whether the audit ledger has
 *   been tampered with. That is exactly what an attacker who just rewrote it wants
 *   to know, and it should not be readable by an ordinary authenticated user.
 *   'security' is included alongside 'admin' to match every other security surface
 *   in this codebase (drift, falco, netpol, posture, soar all use the same pair) —
 *   the security role is who investigates a tamper report. Narrow it to
 *   requireRole('admin') if you would rather diverge from that convention.
 *
 * - auditVerifyLimiter: one call pages the WHOLE ledger out of Appwrite and then
 *   queries Loki. Cost per request grows with the ledger and has no ceiling, so
 *   without a tight limit this is a database amplifier wearing an admin badge.
 *
 * Returns 200 with the report even when tampering is suspected. A non-2xx would
 * be wrong: the verification itself succeeded, and its finding is the payload.
 * Failing the HTTP call would also make an unreachable Loki indistinguishable from
 * a detected rewrite — the distinction the anchor statuses exist to preserve.
 * X-Audit-Status carries the verdict for anything watching headers rather than
 * parsing bodies.
 */
router.get('/verify', verifyUser, requireRole('admin', 'security'), auditVerifyLimiter, async (_req: Request, res: Response) => {
    try {
        const report = await runFullAuditVerification();
        const suspected = isTamperSuspected(report);

        res.setHeader('X-Audit-Status', suspected ? 'TAMPER_DETECTED' : 'OK');

        if (suspected) {
            // error, not warn: this is the line an operator greps for after an
            // incident, and it must not be filtered out with routine noise.
            logger.error('[Audit Verify] ledger integrity check FAILED', {
                event: 'audit_tamper_suspected',
                dbValid: report.db.isValid,
                anchorStatus: report.anchor.status,
                errorKinds: report.db.errors.map(e => e.kind),
                rowsChecked: report.db.rowsChecked,
            });
        }

        return res.status(200).json(report);
    } catch (err: unknown) {
        // A thrown error means the verification could not run at all — which is
        // NOT the same as a clean ledger and must never be reported as one.
        logger.error('[Audit Verify] verification could not run', errorContext(err));
        res.setHeader('X-Audit-Status', 'VERIFICATION_FAILED');
        return res.status(500).json({
            error: 'Audit verification could not be completed',
            message: errorMessage(err),
            detail: 'The ledger has NOT been verified. This is not a statement that it is intact.',
        });
    }
});

export default router;
