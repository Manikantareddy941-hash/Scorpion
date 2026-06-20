import { Router, Response, Request } from 'express';
import { databases, DB_ID, ID, Query } from '../lib/appwrite';
import { verifyUser } from '../middleware/auth';

const router = Router();

// Get policies
router.get('/', verifyUser, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.$id;
        const response = await databases.listDocuments(
            DB_ID,
            'policies',
            [Query.equal('userId', userId)]
        );
        res.json(response.documents);
    } catch (err: any) {
        console.error('[Policy API Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create policy
router.post('/', verifyUser, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.$id;
        const policyData = {
            ...req.body,
            userId,
            isActive: true, // Legacy support
            code: 'N/A' // Legacy support
        };

        const policy = await databases.createDocument(
            DB_ID,
            'policies',
            ID.unique(),
            policyData
        );
        res.json(policy);
    } catch (err: any) {
        console.error('[Policy Create Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update policy
router.patch('/:id', verifyUser, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.$id;

        const existing = await databases.getDocument(DB_ID, 'policies', id);
        if (existing.userId !== userId) {
            return res.status(403).json({ error: 'You do not have access to this policy' });
        }

        // Don't let the request body reassign ownership or the document id
        const { userId: _ignoredUserId, $id: _ignoredId, ...updates } = req.body;

        const policy = await databases.updateDocument(
            DB_ID,
            'policies',
            id,
            updates
        );
        res.json(policy);
    } catch (err: any) {
        console.error('[Policy Update Error]', err.message);
        if (err.code === 404) return res.status(404).json({ error: 'Policy not found' });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete policy
router.delete('/:id', verifyUser, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.$id;

        const existing = await databases.getDocument(DB_ID, 'policies', id);
        if (existing.userId !== userId) {
            return res.status(403).json({ error: 'You do not have access to this policy' });
        }

        await databases.deleteDocument(DB_ID, 'policies', id);
        res.json({ message: 'Policy deleted' });
    } catch (err: any) {
        console.error('[Policy Delete Error]', err.message);
        if (err.code === 404) return res.status(404).json({ error: 'Policy not found' });
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
