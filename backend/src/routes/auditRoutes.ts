import express from 'express';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { Query } from 'node-appwrite';
import { exportEvidence, auditLog } from '../services/auditService';
import { requireRole } from '../middleware/rbac';

const router = express.Router();

// Get audit logs — analyst and admin only
router.get('/', requireRole('admin', 'analyst'), async (req, res) => {
  try {
    const { resource, action, limit = '50' } = req.query;
    const filters = [Query.orderDesc('timestamp'), Query.limit(Number(limit))];
    if (resource) filters.push(Query.equal('resource', resource as string));
    if (action) filters.push(Query.equal('action', action as string));

    const result = await databases.listDocuments(DB_ID, COLLECTIONS.AUDIT_LOGS, filters);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Export evidence pack — admin only
router.post('/evidence', requireRole('admin'), async (req, res) => {
  try {
    const { scanIds, actorEmail } = req.body;
    const evidence = await exportEvidence(scanIds);

    await auditLog({
      action: 'evidence.exported',
      actor: (req as any).userId,
      actorEmail,
      resource: 'scan',
      details: { scanIds }
    });

    res.json(evidence);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export evidence' });
  }
});

// Role management — admin only
router.post('/roles', requireRole('admin'), async (req, res) => {
  try {
    const { userId, role, tenantId } = req.body;
    const { ID } = await import('node-appwrite');

    const doc = await databases.createDocument(DB_ID, COLLECTIONS.ROLES, ID.unique(), {
      userId, role,
      tenantId: tenantId ?? 'default'
    });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign role' });
  }
});

export default router;
