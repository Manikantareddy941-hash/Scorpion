import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { users } from '../lib/appwrite';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Update User Profile
router.patch('/profile', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
