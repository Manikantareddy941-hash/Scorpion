import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { triggerScan } from '../services/scanService';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Add/Sync repository
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        const userId = req.user!.$id;
        const name = url.split('/').pop();

        // Check if repo already exists for this user
        const existingRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId),
            Query.equal('url', url),
            Query.limit(1)
        ]);

        if (existingRepos.total > 0) {
            const data = await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, existingRepos.documents[0].$id, {
                name,
                updated_at: new Date().toISOString()
            });
            return res.json(data);
        }

        const data = await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), {
            user_id: userId,
            url,
            name,
            visibility: 'public',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        res.json(data);
    } catch (error: unknown) {
        next(error);
    }
});

// List repos
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id;

        const ownedRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId),
            Query.orderDesc('updated_at')
        ]);

        res.json(ownedRepos.documents);
    } catch (error: unknown) {
        next(error);
    }
});

// Trigger scan
router.post('/:id/scan', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { visibility } = req.body;
        const { scanId, error } = await triggerScan(repoId, visibility);

        if (error) return res.status(400).json({ error });
        res.json({ scanId, message: 'Scan triggered successfully' });
    } catch (err) {
        next(err);
    }
});

// Get scan status
router.get('/scans/:scanId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { scanId } = req.params;
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        
        if (!scan) return res.status(404).json({ error: 'Scan not found' });

        res.json({
            id: scan.$id,
            status: scan.status,
            details: typeof scan.details === 'string' ? JSON.parse(scan.details) : scan.details,
            created_at: scan.$createdAt
        });
    } catch (err) {
        next(err);
    }
});

export default router;
