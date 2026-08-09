import { Router, Request, Response } from 'express';
import { postureRepository } from '../repositories/postureRepository';
import { requireRole } from '../middleware/requireRole';
import { logger, errorContext } from '../services/logger';

const router = Router();

// Posture data reveals cluster weaknesses — same RBAC posture as driftRoutes.
router.use(requireRole('admin', 'security'));

// GET /api/posture — latest per-namespace posture snapshots.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const data = await postureRepository.listSnapshots();
    res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    logger.error('[Posture API] list snapshots failed', { event: 'POSTURE_API_LIST_FAILED', ...errorContext(err) });
    res.status(500).json({ error: 'Failed to list posture snapshots' });
  }
});

export default router;
