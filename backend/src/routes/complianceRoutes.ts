import express from 'express';
import { evaluateCompliance } from '../services/complianceEngine';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.COMPLIANCE_CONTROLS, []);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch compliance controls' });
  }
});

router.post('/evaluate', async (req, res) => {
  try {
    const results = await evaluateCompliance();
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Compliance evaluation failed' });
  }
});

export default router;
