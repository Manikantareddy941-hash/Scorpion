import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';

const router = Router();

// Get audit logs
router.get('/', verifyUser, async (req: Request, res: Response) => {
    try {
        let docs: any[] = [];
        try {
            const response = await databases.listDocuments(
                DB_ID,
                'audit_logs_v2',
                [
                    Query.orderDesc('timestamp'),
                    Query.limit(100)
                ]
            );
            docs = response.documents;
        } catch (err: any) {
            console.warn('[Audit API V2 Warning] audit_logs_v2 not ready, falling back to legacy:', err.message);
            // Fallback to legacy audit_logs
            const legacyResponse = await databases.listDocuments(
                DB_ID,
                'audit_logs',
                [
                    Query.orderDesc('$createdAt'),
                    Query.limit(100)
                ]
            );
            docs = legacyResponse.documents.map((d: any) => ({
                ...d,
                repo_id: d.resourceId || 'system',
                tamper_hash: 'LEGACY_UNHASHED'
            }));
        }

        res.json(docs);
    } catch (err: any) {
        console.error('[Audit API Error]', err.message, err.stack);
        res.status(500).json({ error: 'Internal server error', message: err.message });
    }
});

// Create audit log (Server-side write)
router.post('/', verifyUser, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
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
    } catch (err: any) {
        console.error('[Audit Create Error]', err.message, err.response || err);
        res.status(500).json({ 
            error: 'Failed to create audit log', 
            message: err.message,
            details: err.response?.message || 'Check Appwrite collection attributes'
        });
    }
});

export default router;
