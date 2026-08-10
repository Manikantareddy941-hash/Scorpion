import { Router, Response } from 'express';
import { autotuneService } from '../services/autotuneService';
import { autotuneProposalRepository, ProposalStatus } from '../repositories/autotuneProposalRepository';
import { AuthenticatedRequest } from '../types/plan.types';
import { logger, errorContext } from '../services/logger';

/**
 * Auto-tune proposals.
 *
 * Everything is scoped to the calling user: v1 tunes personal gate rules only.
 * The cluster-wide 'system' gate config that k8sAdmission and driftMonitor read
 * is deliberately unreachable from here — a proposal against it could halt
 * every deploy in the organisation, and gate rules have no admin tier yet.
 */

const router = Router();

const VALID_STATUS: ProposalStatus[] = ['open', 'applied', 'rejected', 'stale', 'expired'];

router.get('/proposals', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const status = req.query.status as string | undefined;
  if (status && !VALID_STATUS.includes(status as ProposalStatus)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUS.join(', ')}` });
  }

  try {
    res.json(await autotuneProposalRepository.listForUser(userId, status as ProposalStatus | undefined));
  } catch (err) {
    // A truncated queue would hide proposals the operator believes they triaged.
    // The log carries the cause; the body only has to say the list is partial.
    logger.error('[Autotune] proposal list failed', {
      event: 'AUTOTUNE_PROPOSAL_LIST_FAILED', userId, statusFilter: status, ...errorContext(err),
    });
    res.status(503).json({ error: 'Proposals could not be listed in full' });
  }
});

/**
 * Runs the engine now. Triggered rather than scheduled: the first production
 * run should be something an operator watches, not something that surprises
 * them. Nothing here mutates a control — the only output is proposal rows.
 */
router.post('/scan', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { created, skipped } = await autotuneService.scan(userId);
    res.json({ created, createdCount: created.length, skipped });
  } catch (err) {
    logger.error('[Autotune] scan failed', { event: 'AUTOTUNE_SCAN_FAILED', userId, ...errorContext(err) });
    res.status(503).json({ error: 'Evidence could not be read; no proposals generated' });
  }
});

/**
 * The apply path. The service re-runs the proposal's evidence query and refuses
 * if the metric no longer crosses the threshold that justified it, so a spike
 * that resolved while the proposal sat in the queue cannot be rubber-stamped.
 */
router.post('/proposals/:id/:action(approve|reject)', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const action = req.params.action as 'approve' | 'reject';
  const note = typeof req.body?.note === 'string' ? req.body.note : '';
  const result = await autotuneService.decide(req.params.id, userId, action, note);

  switch (result.outcome) {
    case 'applied':
    case 'rejected':
      return res.json({ outcome: result.outcome, proposal: result.proposal });
    case 'stale':
      // 409: the request was well-formed, the world moved.
      return res.status(409).json({ outcome: 'stale', detail: result.detail, proposal: result.proposal });
    case 'expired':
      return res.status(410).json({ outcome: 'expired', proposal: result.proposal });
    case 'not_open':
      return res.status(409).json({ error: `This proposal is already ${result.status}` });
    case 'unavailable':
      // Left open on purpose: an outage is not a reason to discard a proposal.
      return res.status(503).json({ error: 'Evidence could not be verified; nothing was applied', detail: result.detail });
    default:
      return res.status(404).json({ error: 'Not found' });
  }
});

export default router;
