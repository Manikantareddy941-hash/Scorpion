import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { z } from 'zod';
import { gateRulesRepository, GateConfig } from '../repositories/gateRulesRepository';

interface AuthenticatedRequest extends Request {
  user?: Models.User<Models.Preferences>;
}

// Boundary validation — fail fast before anything reaches the repository.
const gateRuleSchema = z.object({
  id: z.string().min(1).max(128),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  threshold: z.number().int().min(0).max(1_000_000),
  action: z.enum(['block', 'warn']),
  enabled: z.boolean(),
});

const gateConfigSchema = z.object({
  rules: z.array(gateRuleSchema).max(100),
  env: z.enum(['dev', 'stage', 'prod']),
}) satisfies z.ZodType<GateConfig>;

const router = Router();

// GET /api/v1/rules — current user's gate configuration (defaults if unsaved).
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const config = await gateRulesRepository.get(userId);
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/rules — replace the current user's gate configuration.
router.put('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = gateConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid gate configuration', details: parsed.error.flatten() });
    }

    const saved = await gateRulesRepository.save(userId, parsed.data);
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

export default router;
