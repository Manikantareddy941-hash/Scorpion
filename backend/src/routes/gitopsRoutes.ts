import { Router, Request, Response, NextFunction } from 'express';
import { handleArgoCDSync } from '../gitops/argocdHandler';
import { logger, errorContext } from '../services/logger';
import { secretMatches } from '../utils/constantTimeCompare';

const router = Router();

// Secret verification middleware for ArgoCD webhooks
function verifyScorpionSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.SCORPION_WEBHOOK_SECRET;
  // Fails closed: an unconfigured secret must never leave this endpoint open.
  // The `!expected` check stays here rather than inside secretMatches so the
  // fail-closed decision is visible at the guard, not delegated to a helper.
  if (!expected || !secretMatches(req.headers['x-scorpion-secret'], expected)) {
    logger.warn('[GitOps] Unauthorized webhook attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/sync', verifyScorpionSecret, async (req: Request, res: Response) => {
  const { app, image, revision, repo, namespace } = req.body;
  
  logger.info(`[GitOps] Received sync notification for app: ${app}`);
  
  // Return 202 Accepted immediately to ArgoCD
  res.status(202).json({ 
    status: 'accepted',
    message: 'Security scan and policy evaluation queued' 
  });
  
  // Run background scan (fire and forget)
  handleArgoCDSync({ app, image, revision, repo, namespace }).catch(err => {
    logger.error('[GitOps] Background sync processing failed:', {
      event: 'GITOPS_SYNC_DISPATCH_FAILED',
      app,
      namespace,
      image,
      revision,
      ...errorContext(err),
    });
  });
});

export default router;
