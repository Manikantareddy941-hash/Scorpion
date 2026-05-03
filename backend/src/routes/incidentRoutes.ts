import express from 'express';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { updateIncidentStatus } from '../services/incidentService';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const filters = status ? [Query.equal('status', status as string)] : [Query.orderDesc('$createdAt'), Query.limit(100)];
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.INCIDENTS, filters);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status, assignee } = req.body;
    const doc = await updateIncidentStatus(req.params.id, status, assignee);
    res.json(doc);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update incident' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await databases.deleteDocument(DB_ID, COLLECTIONS.INCIDENTS, req.params.id);
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete incident' });
  }
});

export default router;
