import express from 'express';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { Query } from 'node-appwrite';

const router = express.Router();

router.get('/', async (req: any, res) => {
  try {
    const { scanId, severity, type, tool, file, limit = '100' } = req.query;
    const filters: any[] = [Query.limit(Number(limit)), Query.orderDesc('$createdAt')];

    if (scanId) filters.push(Query.equal('scanId', scanId as string));
    if (severity) filters.push(Query.equal('severity', severity as string));
    if (type) filters.push(Query.equal('type', type as string));
    if (tool) filters.push(Query.equal('tool', tool as string));
    if (file) filters.push(Query.equal('file', file as string));

    const result = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, filters);
    res.json(result);
  } catch (err: any) {
    console.error('[IssuesRoute] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
