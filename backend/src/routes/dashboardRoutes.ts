import { Router, Response } from 'express';
import { verifyUser } from '../middleware/auth';
import { dashboardService } from '../services/dashboardService';
import { logger, errorContext } from '../services/logger';
import { AuthenticatedRequest } from '../types/dashboard.types';

const router = Router();

router.get('/security', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'User not found' });

  try {
    res.json(await dashboardService.getSecurityDashboard(userId));
  } catch (err) {
    logger.error('[Dashboard API Error]', errorContext(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/posture-breakdown', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'User not found' });
    res.json(await dashboardService.getPostureBreakdown(userId));
  } catch (err) {
    logger.error('[Posture API Error]', errorContext(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/tasks/:id/ai-blueprint', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'User not found' });

    const result = await dashboardService.generateAiBlueprint(req.params.id, userId);
    if (result.forbidden) return res.status(403).json({ error: 'You do not have access to this finding' });
    res.json({ blueprint: result.blueprint });
  } catch (err) {
    logger.error('[Dashboard] AI Blueprint error:', err);
    res.status(500).json({ error: 'Failed to generate AI blueprint' });
  }
});

router.post('/tasks/:id/github-sync', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'User not found' });

    const result = await dashboardService.syncTaskToGithub(req.params.id, userId);
    if ('forbidden' in result) return res.status(403).json({ error: 'You do not have access to this finding' });
    if ('configError' in result) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
    res.json({ success: true, url: result.url });
  } catch (err) {
    // Surface the real failure instead of silently writing a fake issue URL.
    logger.error('[Dashboard] GitHub Sync error:', err);
    res.status(502).json({ error: `Failed to sync with GitHub: ${err instanceof Error ? err.message : 'unknown error'}` });
  }
});

// GET /api/dashboard/metrics - compliance/MTTR summary derived from the caller's
// own open findings (scoped to repos they own).
router.get('/metrics', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'User not found' });
    res.json(await dashboardService.getMetrics(userId));
  } catch (err) {
    logger.error('[Dashboard Metrics Error]', errorContext(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
