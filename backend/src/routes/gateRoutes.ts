import { Router, Response } from 'express';
import { verifyUser } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { checkPermission } from '../middleware/iamMiddleware';
import { gateService, checkReleaseGate } from '../services/gateService';
import { securityRequirementsService } from '../services/securityRequirementsService';
import { logger } from '../services/logger';
import { AuthenticatedRequest, repoIdBodySchema } from '../types/gate.types';

// Re-exported for backward compatibility: pipelineService.ts imports
// checkReleaseGate directly from this module's old location.
export { checkReleaseGate };

const router = Router();

async function assertAccessOr403(req: AuthenticatedRequest, res: Response, repoId: string): Promise<boolean> {
  const allowed = await gateService.assertRepoAccess(repoId, req.user?.$id);
  if (!allowed) {
    res.status(403).json({ error: 'You do not have access to this repository' });
    return false;
  }
  return true;
}

// POST /api/gates/evaluate
router.post('/evaluate', verifyUser, validateBody(repoIdBodySchema), async (req: AuthenticatedRequest, res: Response) => {
  const { repo_id } = req.body;
  try {
    if (!(await assertAccessOr403(req, res, repo_id))) return;
    res.json(await gateService.evaluate(repo_id));
  } catch (err) {
    logger.error('[Gate Evaluate Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error', details: err instanceof Error ? err.message : 'unknown error' });
  }
});

// POST /api/gates/compliance — Build & Test gate. Blocks (403) when a required
// security requirement of any project bound to this repo is violated by a live
// finding. A CI step runs it and fails the build on 403. Separate from the
// finding-severity release gate: this enforces the compliance rulebook.
router.post('/compliance', verifyUser, validateBody(repoIdBodySchema), async (req: AuthenticatedRequest, res: Response) => {
  const { repo_id } = req.body;
  try {
    if (!(await assertAccessOr403(req, res, repo_id))) return;
    const result = await securityRequirementsService.complianceGate(repo_id);
    if (result.blocked) {
      return res.status(403).json({
        allowed: false,
        error: 'Compliance Gate BLOCKED: a required security control is violated by live findings',
        violations: result.violations,
      });
    }
    res.json({ allowed: true, violations: [] });
  } catch (err) {
    logger.error('[Gate Compliance Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error', details: err instanceof Error ? err.message : 'unknown error' });
  }
});

// POST /api/gates/deploy
router.post('/deploy', verifyUser, checkPermission('repo:deploy'), validateBody(repoIdBodySchema), async (req: AuthenticatedRequest, res: Response) => {
  const { repo_id } = req.body;
  try {
    if (!(await assertAccessOr403(req, res, repo_id))) return;

    const result = await gateService.checkDeployable(repo_id);
    if (!result.deployable) {
      return res.status(403).json({
        error: 'Deployment Rejected: CI/CD Release Gate is BLOCKED',
        reason: `Security posture score falls below ${result.minSecurityScore}% threshold or active Critical vulnerabilities are present.`,
        score: result.score,
        blockers: result.blockers
      });
    }

    res.json({ status: 'success', message: 'Deployment triggered successfully. All release gate validations passed.' });
  } catch (err) {
    logger.error('[Gate Deploy Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error', details: err instanceof Error ? err.message : 'unknown error' });
  }
});

// POST /api/gates/override
router.post('/override', verifyUser, checkPermission('gate:bypass'), validateBody(repoIdBodySchema), async (req: AuthenticatedRequest, res: Response) => {
  const { repo_id } = req.body;
  try {
    if (!(await assertAccessOr403(req, res, repo_id))) return;

    await gateService.override(repo_id, req.user?.$id || '');

    res.json({ success: true, message: 'Break Glass Override activated. CI/CD Release Gate has been bypassed and unlocked.' });
  } catch (err) {
    logger.error('[Gate Override Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error', details: err instanceof Error ? err.message : 'unknown error' });
  }
});

// GET /api/gates/state
router.get('/state', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json(await gateService.getState());
  } catch (err) {
    logger.error('[GET Gate State Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch gate state', details: err instanceof Error ? err.message : 'unknown error' });
  }
});

// Original legacy routes for compatibility
router.post('/release', verifyUser, validateBody(repoIdBodySchema), async (req: AuthenticatedRequest, res: Response) => {
  const { repo_id } = req.body;
  try {
    if (!(await assertAccessOr403(req, res, repo_id))) return;
    res.json(await gateService.legacyRelease(repo_id, req.user?.$id || ''));
  } catch (err) {
    logger.error('[Gate API Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/release/:repo_id', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  const { repo_id } = req.params;
  try {
    if (!(await assertAccessOr403(req, res, repo_id))) return;
    res.json(await checkReleaseGate(repo_id));
  } catch (err) {
    logger.error('[Gate API Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json(await gateService.getSummary(req.user?.$id || ''));
  } catch (err) {
    logger.error('[Gate Summary API Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
