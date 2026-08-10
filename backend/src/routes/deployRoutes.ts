import express, { Request } from 'express';
import { triggerDeploy, rollbackDeploy } from '../deploy/deployService';
import { databases, COLLECTIONS, DB_ID, Query } from '../lib/appwrite';
import { assertRepoAccess, resolveOwnershipScope, TenantAccessError } from '../services/tenancyService';
import { hasPermission } from '../middleware/iamMiddleware';

interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: { $id: string; email?: string };
}

const router = express.Router();

/**
 * POST /api/deployments/trigger or POST /api/deploy
 * Trigger a new deployment
 */
router.post(['/', '/trigger'], async (req: AuthenticatedRequest, res) => {
  try {
    const { buildId, environment, break_glass } = req.body;
    const userId = req.user?.$id;
    const triggeredBy = req.user?.email || 'unknown';

    if (!buildId || !environment) {
      return res.status(400).json({ error: 'buildId and environment are required' });
    }
    if (!['dev', 'staging', 'production'].includes(environment)) {
      return res.status(400).json({ error: 'environment must be one of: dev, staging, production' });
    }

    const build = await databases.getDocument(DB_ID, COLLECTIONS.BUILD_PIPELINES, buildId);
    await assertRepoAccess(build.repoId, userId || '');

    if (!(await hasPermission(req, userId || '', 'repo:deploy', build.repoId))) {
      return res.status(403).json({ error: 'You do not have permission to deploy this repository' });
    }

    // Break-glass (bypass the compliance gate) is a separate, higher privilege
    // than deploy — it requires gate:bypass. The override itself is tamper-
    // audited inside triggerDeploy.
    let breakGlass = false;
    if (break_glass === true) {
      if (!(await hasPermission(req, userId || '', 'gate:bypass', build.repoId))) {
        return res.status(403).json({ error: 'Break-glass deploy requires the gate:bypass permission' });
      }
      breakGlass = true;
    }

    // Trigger deployment async (doesn't await completion)
    const result = await triggerDeploy(buildId, environment as 'dev' | 'staging' | 'production', triggeredBy, breakGlass);

    res.status(202).json({
      message: 'Deployment triggered',
      deploymentId: result.deploymentId,
      status: result.status,
      reason: 'reason' in result ? result.reason : undefined
    });
  } catch (err) {
    if (err instanceof TenantAccessError) return res.status(403).json({ error: err.message });
    res.status(500).json({ error: 'Failed to trigger deployment' });
  }
});

/**
 * GET /api/deployments
 * List all deployments with optional filters
 */
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { repoId, buildId, environment, status, limit = 50 } = req.query;
    const userId = req.user?.$id;

    if (repoId) {
      await assertRepoAccess(String(repoId), userId || '');
    }

    const queries: string[] = [
      Query.orderDesc('$createdAt'),
      Query.limit(Number(limit))
    ];

    if (repoId) {
      queries.push(Query.equal('repoId', String(repoId)));
    } else {
      const scope = await resolveOwnershipScope(req, userId || '');
      const ownedRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.equal(scope.field, scope.value)]);
      const repoIds = ownedRepos.documents.map(r => r.$id);
      queries.push(Query.equal('repoId', repoIds.length > 0 ? repoIds : ['__none__']));
    }
    if (buildId) queries.push(Query.equal('buildId', String(buildId)));
    if (environment) queries.push(Query.equal('environment', String(environment)));
    if (status) queries.push(Query.equal('status', String(status)));

    const results = await databases.listDocuments(DB_ID, COLLECTIONS.DEPLOYMENTS, queries);
    res.json(results);
  } catch (err) {
    if (err instanceof TenantAccessError) return res.status(403).json({ error: err.message });
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

/**
 * GET /api/deployments/environments
 * List all known environments
 */
router.get('/environments', async (req: AuthenticatedRequest, res) => {
  try {
    // Static list of supported environments
    const environments = ['dev', 'staging', 'production'];
    res.json({ environments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch environments' });
  }
});

/**
 * GET /api/deployments/:id or GET /api/deploy/:id/status
 * Get a single deployment by ID
 */
router.get(['/:id', '/:id/status'], async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.$id;
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, req.params.id);
    await assertRepoAccess(doc.repoId, userId || '');
    res.json(doc);
  } catch (err) {
    if (err instanceof TenantAccessError) return res.status(403).json({ error: err.message });
    res.status(404).json({ error: 'Deployment not found' });
  }
});

/**
 * POST /api/deployments/:id/rollback
 * Manually trigger a rollback for a deployment
 */
router.post('/:id/rollback', async (req: AuthenticatedRequest, res) => {
  try {
    const deploymentId = req.params.id;
    const userId = req.user?.$id;

    const doc = await databases.getDocument(DB_ID, COLLECTIONS.DEPLOYMENTS, deploymentId);
    await assertRepoAccess(doc.repoId, userId || '');
    if (!(await hasPermission(req, userId || '', 'repo:deploy', doc.repoId))) {
      return res.status(403).json({ error: 'You do not have permission to roll back deployments for this repository' });
    }
    if (doc.status !== 'success') {
      return res.status(400).json({ error: `Cannot rollback a deployment with status: ${doc.status}` });
    }

    const result = await rollbackDeploy(deploymentId);

    res.json({
      message: 'Rollback initiated',
      deploymentId: result.deploymentId,
      status: result.status
    });
  } catch (err) {
    if (err instanceof TenantAccessError) return res.status(403).json({ error: err.message });
    res.status(500).json({ error: 'Failed to rollback deployment' });
  }
});

export default router;
