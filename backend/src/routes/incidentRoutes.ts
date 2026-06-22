import express, { Request } from 'express';
import { Models } from 'node-appwrite';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { updateIncidentStatus } from '../services/incidentService';

interface AuthenticatedRequest extends Request {
  user?: Models.User<Models.Preferences>;
}

const router = express.Router();

router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id || '';
    const { status } = req.query;
    const filters = [
      Query.equal('user_id', userId),
      ...(status ? [Query.equal('status', status as string)] : [Query.orderDesc('$createdAt'), Query.limit(100)])
    ];
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.INCIDENTS, filters);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

router.patch('/:id/status', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    const existing = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id);
    if (existing.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this incident' });
    }

    const { status, assignee } = req.body;
    const doc = await updateIncidentStatus(req.params.id, status, assignee);
    res.json(doc);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update incident' });
  }
});

router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    const existing = await databases.getDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id);
    if (existing.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this incident' });
    }

    await databases.deleteDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id);
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete incident' });
  }
});

export default router;
