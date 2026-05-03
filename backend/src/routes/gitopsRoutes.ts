import { Router, Request, Response, NextFunction } from 'express';
import { handleArgoCDSync } from '../gitops/argocdHandler';

const router = Router();

// Secret verification middleware for ArgoCD webhooks
function verifyScorpionSecret(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers['x-scorpion-secret'];
  console.log(`[GitOps] Verifying secret: ${secret} vs ${process.env.SCORPION_WEBHOOK_SECRET}`);
  if (secret !== process.env.SCORPION_WEBHOOK_SECRET) {
    console.warn('[GitOps] Unauthorized webhook attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/sync', verifyScorpionSecret, async (req: Request, res: Response) => {
  const { app, image, revision, repo, namespace } = req.body;
  
  console.log(`[GitOps] Received sync notification for app: ${app}`);
  
  // Return 202 Accepted immediately to ArgoCD
  res.status(202).json({ 
    status: 'accepted',
    message: 'Security scan and policy evaluation queued' 
  });
  
  // Run background scan (fire and forget)
  handleArgoCDSync({ app, image, revision, repo, namespace }).catch(err => {
    console.error('[GitOps] Background sync processing failed:', err);
  });
});

export default router;
