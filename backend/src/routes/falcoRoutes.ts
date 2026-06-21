import { Router, Request, Response } from 'express';
import { handleFalcoEvent } from '../runtime/falcoHandler';
import { logger } from '../services/logger';

const router = Router();

// Middleware to verify Falco secret if configured
const verifyFalcoSecret = (req: Request, res: Response, next: any) => {
  const expected = process.env.FALCO_SECRET;
  const secret = req.headers['x-falco-secret'];
  // Fails closed: an unconfigured secret must never leave this endpoint open.
  if (!expected || secret !== expected) {
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
    logger.error('[Falco] Error processing event:', err);
  });
});

export default router;
