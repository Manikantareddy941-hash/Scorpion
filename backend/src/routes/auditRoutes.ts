import { Router, Response, Request } from 'express';
import { databases, DB_ID, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';

const router = Router();

// Get audit logs
router.get('/', verifyUser, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.$id;
        
        // Fetch logs for user (or filtered by repos if we had a more complex multi-tenant model)
        const response = await databases.listDocuments(
            DB_ID,
            'audit_logs',
            [
                Query.equal('actor', userId),
                Query.orderDesc('created_at'),
                Query.limit(100)
            ]
        );

        res.json(response.documents);
    } catch (err: any) {
        console.error('[Audit API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
