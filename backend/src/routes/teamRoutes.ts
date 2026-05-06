import { Router, Response, Request, NextFunction } from 'express';
import { Models, ID } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query, users } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

// List teams for user
router.get('/', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id;
        
        // Get memberships for user
        const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
            Query.equal('user_id', userId)
        ]);

        if (memberships.total === 0) return res.json([]);

        // Get team details
        const teamIds = memberships.documents.map(m => m.team_id);
        const teams = await databases.listDocuments(DB_ID, COLLECTIONS.TEAMS, [
            Query.equal('$id', teamIds)
        ]);

        // Merge role into team object
        const results = teams.documents.map(team => {
            const m = memberships.documents.find(m => m.team_id === team.$id);
            return { ...team, role: m?.role || 'viewer' };
        });

        res.json(results);
    } catch (err) {
        next(err);
    }
});

// Create a new team
router.post('/', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Team name is required' });

        const userId = req.user!.$id;
        
        const team = await databases.createDocument(DB_ID, COLLECTIONS.TEAMS, ID.unique(), {
            name,
            description: description || '',
            owner_id: userId,
            created_at: new Date().toISOString()
        });

        // Add creator as owner
        await databases.createDocument(DB_ID, COLLECTIONS.TEAM_MEMBERS, ID.unique(), {
            team_id: team.$id,
            user_id: userId,
            role: 'owner',
            joined_at: new Date().toISOString()
        });

        res.json(team);
    } catch (err) {
        next(err);
    }
});

// Get team members
router.get('/:id/members', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const teamId = req.params.id;
        const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
            Query.equal('team_id', teamId)
        ]);

        // Enrich with user emails (requires admin users API)
        const enrichedMembers = await Promise.all(memberships.documents.map(async m => {
            try {
                const user = await users.get(m.user_id);
                return { ...m, email: user.email, name: user.name };
            } catch {
                return { ...m, email: 'unknown@user.com', name: 'Unknown User' };
            }
        }));

        res.json(enrichedMembers);
    } catch (err) {
        next(err);
    }
});

// Invite user to team
router.post('/:id/invite', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
            return res.status(404).json({ error: 'User not found in system' });
        }

        const invitedUser = userList.users[0];

        // Check if already a member
        const existing = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
            Query.equal('team_id', teamId),
            Query.equal('user_id', invitedUser.$id),
            Query.limit(1)
        ]);

        if (existing.total > 0) {
            return res.status(400).json({ error: 'User is already a member of this team' });
        }

        const data = await databases.createDocument(DB_ID, COLLECTIONS.TEAM_MEMBERS, ID.unique(), {
            team_id: teamId,
            user_id: invitedUser.$id,
            role: role || 'viewer',
            joined_at: new Date().toISOString()
        });

        res.json({ message: 'User added to team', data });
    } catch (err) {
        next(err);
    }
});

// Remove member
router.delete('/:id/members/:userId', verifyUser, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const teamId = req.params.id;
        const memberUserId = req.params.userId;
        const userId = req.user!.$id;

        // Check permission
        const memberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
            Query.equal('team_id', teamId),
            Query.equal('user_id', userId),
            Query.limit(1)
        ]);

        if (memberships.total === 0 || !['owner', 'admin'].includes(memberships.documents[0].role)) {
            if (userId !== memberUserId) {
                return res.status(403).json({ error: 'Permission denied' });
            }
        }

        // Find membership doc ID
        const targetMembership = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
            Query.equal('team_id', teamId),
            Query.equal('user_id', memberUserId),
            Query.limit(1)
        ]);

        if (targetMembership.total > 0) {
            await databases.deleteDocument(DB_ID, COLLECTIONS.TEAM_MEMBERS, targetMembership.documents[0].$id);
        }

        res.json({ message: 'Member removed' });
    } catch (err) {
        next(err);
    }
});

export default router;
