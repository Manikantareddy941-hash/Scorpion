import { Router, Request, Response, NextFunction } from 'express';
import { postureRepository } from '../repositories/postureRepository';
import { requireRole } from '../middleware/requireRole';

const router = Router();

// Posture data reveals cluster weaknesses — same RBAC posture as driftRoutes.
router.use(requireRole('admin', 'security'));

// GET /api/posture — latest per-namespace posture snapshots.
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await postureRepository.listSnapshots();
    res.json({ success: true, data, meta: { total: data.length } });
  } catch (err) {
    next(err);
  }
});

export default router;
