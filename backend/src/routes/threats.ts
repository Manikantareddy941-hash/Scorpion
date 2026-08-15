import { Router, Request, Response, NextFunction } from 'express';
import { verifyUser } from '../middleware/auth';
import { threatsService } from '../services/threatsService';
import { logger, errorContext } from '../services/logger';
import { AuthenticatedRequest, falcoEventSchema } from '../types/threats.types';
import { secretMatches } from '../utils/constantTimeCompare';

const router = Router();

// Same shared-secret pattern as routes/falcoRoutes.ts's verifyFalcoSecret
const verifyFalcoSecret = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.FALCO_SECRET;
  // Fails closed: an unconfigured secret must never leave this endpoint open.
  // The `!expected` check stays here rather than inside secretMatches so the
  // fail-closed decision is visible at the guard, not delegated to a helper.
  if (!expected || !secretMatches(req.headers['x-falco-secret'], expected)) {
    return res.status(401).json({ error: 'Unauthorized Falco source' });
  }
  next();
};

// Initialize collections asynchronously on startup/first-hit
threatsService.bootstrap();

// POST /api/threats/falco
router.post('/falco', verifyFalcoSecret, async (req: Request, res: Response) => {
  const parsed = falcoEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid Falco event payload' });
  }
  const event = parsed.data;
  logger.info(`[Falco Webhook] Received event: ${event.rule} (${event.priority})`);

  try {
    const { threatId, status } = await threatsService.ingestFalcoEvent(event);
    res.status(202).json({
      status: 'success',
      message: 'Threat normalized and ingested successfully',
      threatId,
      nodeStatus: status
    });
  } catch (err) {
    logger.error('[Falco Webhook] Failed to process webhook event:', {
      event: 'FALCO_WEBHOOK_INGEST_FAILED',
      rule: event.rule,
      priority: event.priority,
      ...errorContext(err),
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /api/threats
router.get('/', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    res.json(await threatsService.listThreats(userId));
  } catch (err) {
    logger.error('[GET Threats API] Failed to retrieve threats:', {
      event: 'THREATS_LIST_FAILED',
      userId: req.user?.$id,
      ...errorContext(err),
    });
    res.status(500).json({ error: 'Failed to retrieve threats' });
  }
});

// POST /api/threats/clear - Diagnostic endpoint to reset/clear threat state back to passing
router.post('/clear', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    await threatsService.clearThreats(userId);
    res.json({ status: 'success', message: 'All pipeline threats cleared and reset.' });
  } catch (err) {
    // Clearing threats resets pipeline gate state — a failure here leaves the
    // caller believing the board is clean when it is not.
    logger.error('[Clear Threats API] Failed to reset states:', {
      event: 'THREATS_CLEAR_FAILED',
      userId: req.user?.$id,
      ...errorContext(err),
    });
    res.status(500).json({ error: 'Clear operation failed' });
  }
});

export default router;
