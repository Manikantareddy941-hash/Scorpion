import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
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
            logger.warn('[Audit API V2 Warning] audit_logs_v2 not ready, falling back to legacy:', errorMessage(err));
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
        logger.error('[Audit API Error]', message, err instanceof Error ? err.stack : undefined);
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
        logger.error('[Audit Create Error]', message, response_ || err);
        res.status(500).json({
            error: 'Failed to create audit log',
            message,
            details: response_?.message || 'Check Appwrite collection attributes'
        });
    }
});

export default router;
