import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import crypto from 'crypto';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// List API Keys
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.API_KEYS, [
            Query.equal('user_id', req.user!.$id),
            Query.orderDesc('$createdAt')
        ]);
        res.json(response.documents);
    } catch (err) {
        next(err);
    }
});

// Create API Key
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name is required' });

    try {
        const rawKey = `sp_${crypto.randomBytes(24).toString('hex')}`;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const data = await databases.createDocument(DB_ID, COLLECTIONS.API_KEYS, ID.unique(), {
            user_id: req.user!.$id,
            name,
            key_hash: keyHash,
            created_at: new Date().toISOString()
        });

        res.json({ ...data, api_key: rawKey });
    } catch (err) {
        next(err);
    }
});

// Delete API Key
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        await databases.deleteDocument(DB_ID, COLLECTIONS.API_KEYS, req.params.id);
        res.json({ message: 'API Key revoked' });
    } catch (err) {
        next(err);
    }
});

export default router;
