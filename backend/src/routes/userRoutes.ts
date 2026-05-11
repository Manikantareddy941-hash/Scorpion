import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { users, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences> & { $id: string };
}

const router = Router();

// Get Current User Role
router.get('/role', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.$id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const roleRes = await databases.listDocuments(DB_ID, COLLECTIONS.ROLES, [
            Query.equal('userId', userId)
        ]);

        if (roleRes.documents.length > 0) {
            return res.json({ role: (roleRes.documents[0] as any).role });
        }

        res.json({ role: 'user' }); // Default role
    } catch (error: unknown) {
        next(error);
    }
});

// Update User Profile
router.patch('/profile', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { displayName } = req.body;
    try {
        const user = await users.updatePrefs(req.user!.$id, {
            ...req.user!.prefs,
            display_name: displayName
        });

        res.json({ message: 'Profile updated', user });
    } catch (error: unknown) {
        next(error);
    }
});

export default router;
