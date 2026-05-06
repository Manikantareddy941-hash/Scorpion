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
        const policy = await databases.updateDocument(
            DB_ID,
            'policies',
            id,
            req.body
        );
        res.json(policy);
    } catch (err: any) {
        console.error('[Policy Update Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete policy
router.delete('/:id', verifyUser, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await databases.deleteDocument(DB_ID, 'policies', id);
        res.json({ message: 'Policy deleted' });
    } catch (err: any) {
        console.error('[Policy Delete Error]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
