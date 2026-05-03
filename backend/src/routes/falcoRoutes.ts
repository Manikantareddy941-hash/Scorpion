import { Router, Request, Response } from 'express';
import { handleFalcoEvent } from '../runtime/falcoHandler';

const router = Router();

// Middleware to verify Falco secret if configured
const verifyFalcoSecret = (req: Request, res: Response, next: any) => {
  const secret = req.headers['x-falco-secret'];
  if (process.env.FALCO_SECRET && secret !== process.env.FALCO_SECRET) {
    return res.status(401).json({ error: 'Unauthorized Falco source' });
  }
  next();
};

router.post('/event', verifyFalcoSecret, async (req: Request, res: Response) => {
  const event = req.body;
  
  console.log(`[Falco] Received runtime event: ${event.rule} (${event.priority})`);
  
  // Acknowledge immediately
  res.status(202).json({ status: 'received' });

  // Process asynchronously
  handleFalcoEvent(event).catch(err => {
    console.error('[Falco] Error processing event:', err);
  });
});

export default router;
