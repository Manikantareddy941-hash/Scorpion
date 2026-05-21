import express from 'express';
import { triggerDeploy, rollbackDeploy } from '../deploy/deployService';
import { databases, COLLECTIONS, DB_ID, Query } from '../lib/appwrite';

const router = express.Router();

/**
 * POST /api/deployments/trigger
 * Trigger a new deployment
 */
router.post('/trigger', async (req, res) => {
  try {
    const { buildId, environment } = req.body;
    const triggeredBy = (req as any).user?.email || 'unknown';

    if (!buildId || !environment) {
      return res.status(400).json({ error: 'buildId and environment are required' });
    }

    // Trigger deployment async (doesn't await completion)
    const result = await triggerDeploy(buildId, environment as 'dev' | 'staging' | 'production', triggeredBy);

    res.status(202).json({
      message: 'Deployment triggered',
      deploymentId: result.deploymentId,
      status: result.status,
      reason: (result as any).reason
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to trigger deployment', details: err.message });
  }
});

/**
 * GET /api/deployments
 * List all deployments with optional filters
 */
router.get('/', async (req, res) => {
  try {
    const { repoId, buildId, environment, status, limit = 50 } = req.query;
    
    const queries: string[] = [
      Query.orderDesc('$createdAt'),
      Query.limit(Number(limit))
    ];

    if (repoId) queries.push(Query.equal('repoId', String(repoId)));
    if (buildId) queries.push(Query.equal('buildId', String(buildId)));
    if (environment) queries.push(Query.equal('environment', String(environment)));
    if (status) queries.push(Query.equal('status', String(status)));

    const results = await databases.listDocuments(DB_ID, COLLECTIONS.DEPLOYMENTS, queries);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch deployments', details: err.message });
  }
});

/**
 * GET /api/deployments/environments
 * List all known environments
 */
router.get('/environments', async (req, res) => {
  try {
    // Static list of supported environments
    const environments = ['dev', 'staging', 'production'];
    res.json({ environments });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch environments', details: err.message });
  }
});

/**
 * GET /api/deployments/:id
 * Get a single deployment by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, req.params.id);
    res.json(doc);
  } catch (err: any) {
    res.status(404).json({ error: 'Deployment not found', details: err.message });
  }
});

/**
 * POST /api/deployments/:id/rollback
 * Manually trigger a rollback for a deployment
 */
router.post('/:id/rollback', async (req, res) => {
  try {
    const deploymentId = req.params.id;

    const doc = await databases.getDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId);
    if (doc.status !== 'success') {
      return res.status(400).json({ error: `Cannot rollback a deployment with status: ${doc.status}` });
    }

    const result = await rollbackDeploy(deploymentId);

    res.json({ 
      message: 'Rollback initiated', 
      deploymentId: result.deploymentId,
      status: result.status 
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to rollback deployment', details: err.message });
  }
});

export default router;
