import express from 'express';
import { evaluateCompliance } from '../services/complianceEngine';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user?.$id;
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.COMPLIANCE_CONTROLS, [Query.equal('scopeId', userId)]);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch compliance controls' });
  }
});

router.post('/evaluate', async (req, res) => {
  try {
    const userId = (req as any).user?.$id;
    const results = await evaluateCompliance(userId);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Compliance evaluation failed' });
  }
});

export default router;
