import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { verifyUser } from '../middleware/auth';
import { suppressionRepository } from '../repositories/suppressionRepository';
import { logger } from '../services/logger';
import type { SuppressionRule } from '../monitor/suppressionMatcher';

interface AuthedRequest extends Request<Record<string, string>> { user?: Models.User<Models.Preferences>; }
const router = Router();
const VALID = new Set(['ruleId', 'severity', 'repo', 'actor']);

router.get('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try { res.json(await suppressionRepository.listForOwner(req.user?.$id || '')); }
  catch (err) { logger.error('[suppressionRoutes] list', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const { matchType, matchValue, expiresAt, reason } = req.body;
    if (!VALID.has(matchType) || !matchValue) return res.status(400).json({ error: 'matchType and matchValue required' });
    const rule: Omit<SuppressionRule, 'id'> = { matchType, matchValue, expiresAt, reason };
    res.status(201).json(await suppressionRepository.create(req.user?.$id || '', rule));
  } catch (err) { logger.error('[suppressionRoutes] create', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/:id', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const ok = await suppressionRepository.remove(req.user?.$id || '', req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { logger.error('[suppressionRoutes] delete', err); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
