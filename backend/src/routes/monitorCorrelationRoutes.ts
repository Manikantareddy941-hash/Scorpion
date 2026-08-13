import { Router, Response, Request } from 'express';
import { Models } from 'node-appwrite';
import { verifyUser } from '../middleware/auth';
import { resolveOwnershipScope } from '../services/tenancyService';
import { correlationRepository } from '../repositories/correlationRepository';
import { enqueueCorrelationTick } from '../queues/correlationQueue';
import { CORRELATION_CATALOG, catalogById } from '../monitor/correlationCatalog';
import { logger, errorContext } from '../services/logger';
import type { Severity } from '../monitor/securityEvent.types';

interface AuthedRequest extends Request<Record<string, string>> { user?: Models.User<Models.Preferences>; }
const router = Router();

router.get('/', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    // ponytail: seeds this tenant's correlation loop on first view; self-perpetuates via
    // startCorrelationWorker's re-enqueue, so no tenant registry is needed.
    void enqueueCorrelationTick({ ownerUserId: userId }, 0);
    await resolveOwnershipScope(req, userId);
    res.json(await correlationRepository.listFired('owner', userId));
  } catch (err) { logger.error('[correlationRoutes] list failed', { event: 'CORRELATION_LIST_FAILED', ...errorContext(err) }); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/rules', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    const states = await correlationRepository.listRuleStates(userId);
    const byId = new Map(states.map(s => [s.id, s]));
    res.json(CORRELATION_CATALOG.map(r => {
      const st = byId.get(r.id);
      return { id: r.id, title: r.title, severity: st?.severityOverride ?? r.severity,
        enabled: st ? st.enabled : true, windowMs: r.windowMs };
    }));
  } catch (err) { logger.error('[correlationRoutes] rules failed', { event: 'CORRELATION_RULES_READ_FAILED', ...errorContext(err) }); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/rules/:id', verifyUser, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    if (!catalogById(req.params.id)) return res.status(404).json({ error: 'Unknown rule' });
    const enabled = req.body.enabled ?? true;
    const severityOverride = req.body.severityOverride as Severity | undefined;
    await correlationRepository.upsertRuleState(userId, { id: req.params.id, enabled, severityOverride });
    res.json({ ok: true });
  } catch (err) { logger.error('[correlationRoutes] toggle failed', { event: 'CORRELATION_RULE_TOGGLE_FAILED', ruleId: req.params.id, ...errorContext(err) }); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
