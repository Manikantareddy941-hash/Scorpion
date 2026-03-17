import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Get notification history
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATIONS, [
            Query.equal('user_id', req.user!.$id),
            Query.orderDesc('$createdAt'),
            Query.limit(50)
        ]);
        res.json(response.documents);
    } catch (err) {
        next(err);
    }
});

// Get notification preferences
router.get('/preferences', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATION_PREFERENCES, [
            Query.equal('user_id', req.user!.$id)
        ]);
        res.json(response.documents);
    } catch (err) {
        next(err);
    }
});

// Update notification preferences
router.put('/preferences', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { preferences } = req.body;
        if (!Array.isArray(preferences)) throw new Error('Preferences must be an array');

        const userId = req.user!.$id;

        for (const pref of preferences) {
            const existing = await databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATION_PREFERENCES, [
                Query.equal('user_id', userId),
                Query.equal('repo_id', pref.repo_id),
                Query.equal('channel', pref.channel),
                Query.equal('event_type', pref.event_type),
                Query.limit(1)
            ]);

            if (existing.total > 0) {
                await databases.updateDocument(DB_ID, COLLECTIONS.NOTIFICATION_PREFERENCES, existing.documents[0].$id, {
                    ...pref,
                    updated_at: new Date().toISOString()
                });
            } else {
                await databases.createDocument(DB_ID, COLLECTIONS.NOTIFICATION_PREFERENCES, ID.unique(), {
                    user_id: userId,
                    ...pref,
                    updated_at: new Date().toISOString()
                });
            }
        }

        res.json({ message: 'Preferences updated successfully' });
    } catch (err) {
        next(err);
    }
});

// Test notification
router.post('/test', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { channel, target } = req.body;
        res.json({ message: `Test notification queued for ${channel}` });
    } catch (err) {
        next(err);
    }
});

export default router;
