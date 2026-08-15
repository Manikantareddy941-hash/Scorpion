import { Router, Request, Response, NextFunction } from 'express';
import { handleFalcoEvent } from '../runtime/falcoHandler';
import { logger, errorContext } from '../services/logger';
import { secretMatches } from '../utils/constantTimeCompare';

const router = Router();

// Middleware to verify Falco secret if configured
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

router.post('/event', verifyFalcoSecret, async (req: Request, res: Response) => {
  const event = req.body;
  
  logger.info(`[Falco] Received runtime event: ${event.rule} (${event.priority})`);
  
  // Acknowledge immediately
  res.status(202).json({ status: 'received' });

  // Process asynchronously
  handleFalcoEvent(event).catch(err => {
    logger.error('[Falco] Error processing event:', {
      event: 'FALCO_EVENT_PROCESSING_FAILED',
      rule: event?.rule,
      priority: event?.priority,
      ...errorContext(err),
    });
  });
});

export default router;
