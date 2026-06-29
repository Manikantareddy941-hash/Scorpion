import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { driftRepository } from '../repositories/driftRepository';
import { requireRole } from '../middleware/requireRole';

// Boundary validation — coerce/clamp query params before the repository sees them.
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  driftType: z.enum(['gate-violation', 'unscanned-image', 'out-of-band-update']).optional(),
});

const router = Router();

// RBAC: runtime drift data is sensitive — restrict to admin and security
// personnel. Authentication (req.user) is enforced upstream at the mount point
// in index.ts (`app.use('/api/v1/drift', authenticate, driftRoutes)`).
router.use(requireRole('admin', 'security'));

// GET /api/v1/drift — active runtime drift records, severity- then time-sorted.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }
    const records = await driftRepository.listActive(parsed.data);
    res.json({ success: true, data: records, meta: { total: records.length } });
  } catch (err) {
    next(err);
  }
});

export default router;
