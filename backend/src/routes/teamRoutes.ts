import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query, users } from '../lib/appwrite';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// Create a new team
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Team name is required' });

        const userId = req.user!.$id;
        
        const team = await databases.createDocument(DB_ID, COLLECTIONS.TEAM_MEMBERS, ID.unique(), {
            name,
            owner_id: userId
        });

        await databases.createDocument(DB_ID, COLLECTIONS.TEAM_MEMBERS, ID.unique(), {
            team_id: team.$id,
            user_id: userId,
            role: 'owner'
        });

        res.json(team);
    } catch (err) {
        next(err);
    }
});

// Invite user to team
router.post('/:id/invite', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const teamId = req.params.id;
        const { email, role } = req.body;

        const userId = req.user!.$id;

        const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
            Query.equal('team_id', teamId),
            Query.equal('user_id', userId),
            Query.limit(1)
        ]);

        if (memberships.total === 0 || !['owner', 'admin'].includes(memberships.documents[0].role)) {
            return res.status(403).json({ error: 'Only team owners or admins can invite members' });
        }

        const userList = await users.list([
            Query.equal('email', email),
            Query.limit(1)
        ]);

        if (userList.total === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const invitedUser = userList.users[0];

        const data = await databases.createDocument(DB_ID, COLLECTIONS.TEAM_MEMBERS, ID.unique(), {
            team_id: teamId,
            user_id: invitedUser.$id,
            role: role || 'viewer'
        });

        res.json({ message: 'User invited successfully', data });
    } catch (err) {
        next(err);
    }
});

export default router;
