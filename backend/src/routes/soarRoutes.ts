import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { soarRepository, SoarActionStatus } from '../repositories/soarRepository';
import { enqueueSoarAction } from '../queues/soarQueue';
import { requireRole } from '../middleware/requireRole';
import { logger, errorContext } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: { $id: string; email?: string };
}

const prioritySchema = z.enum(['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug']);

const playbookSchema = z.object({
  name: z.string().min(1).max(128),
  enabled: z.boolean(),
  trigger: z.object({
    rulePattern: z.string().min(1).max(256).optional(),
    minPriority: prioritySchema,
  }),
  actions: z.array(z.object({
    type: z.enum(['capture_evidence', 'slack_escalate', 'isolate_pod', 'kill_pod']),
    mode: z.enum(['auto', 'approval']),
  })).min(1).max(10),
});

const actionStatusSchema = z.enum(['pending', 'approved', 'rejected', 'executed', 'failed']);

const router = Router();

// Runtime response controls are sensitive — same RBAC posture as driftRoutes.
router.use(requireRole('admin', 'security'));

router.get('/playbooks', async (_req: Request, res: Response) => {
  try {
    res.json({ playbooks: await soarRepository.listPlaybooks() });
  } catch (err) {
    logger.error('[SOAR API] list playbooks failed', errorContext(err));
    res.status(500).json({ error: 'Failed to list playbooks' });
  }
});

router.post('/playbooks', async (req: Request, res: Response) => {
  const parsed = playbookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid playbook', details: parsed.error.flatten() });
  }
  try {
    const playbook = await soarRepository.createPlaybook(parsed.data);
    res.status(201).json({ playbook });
  } catch (err) {
    logger.error('[SOAR API] create playbook failed', errorContext(err));
    res.status(500).json({ error: 'Failed to create playbook' });
  }
});

router.patch('/playbooks/:id', async (req: Request<Record<string, string>>, res: Response) => {
  const parsed = playbookSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid playbook update', details: parsed.error.flatten() });
  }
  try {
    await soarRepository.updatePlaybook(req.params.id, parsed.data);
    res.json({ status: 'updated' });
  } catch (err) {
    logger.error('[SOAR API] update playbook failed', errorContext(err));
    res.status(500).json({ error: 'Failed to update playbook' });
  }
});

router.get('/actions', async (req: Request, res: Response) => {
  const status = req.query.status !== undefined ? actionStatusSchema.safeParse(req.query.status) : undefined;
  if (status && !status.success) return res.status(400).json({ error: 'Invalid status filter' });
  try {
    const actions = await soarRepository.listActions(status?.data as SoarActionStatus | undefined);
    res.json({ actions });
  } catch (err) {
    logger.error('[SOAR API] list actions failed', errorContext(err));
    res.status(500).json({ error: 'Failed to list actions' });
  }
});

/** Shared approve/reject resolution: only a 'pending' action can be resolved. */
async function resolveAction(
  req: AuthenticatedRequest,
  res: Response,
  target: 'approved' | 'rejected',
): Promise<void> {
  const action = await soarRepository.getAction(req.params.id);
  if (!action) {
    res.status(404).json({ error: 'Action not found' });
    return;
  }
  if (action.status !== 'pending') {
    res.status(409).json({ error: `Action is '${action.status}', not pending` });
    return;
  }
  const resolvedBy = req.user?.email ?? req.user?.$id ?? 'unknown';
  await soarRepository.setActionStatus(action.id, target, { resolvedBy });
  // ownerUserId scopes downstream Slack escalation to the repo owner (fail-secure).
  if (target === 'approved') await enqueueSoarAction({ actionId: action.id, ownerUserId: action.ownerUserId });
  res.json({ status: target });
}

router.post('/actions/:id/approve', (req: AuthenticatedRequest, res: Response) => {
  resolveAction(req, res, 'approved').catch((err) => {
    logger.error('[SOAR API] approve failed', errorContext(err));
    res.status(500).json({ error: 'Failed to approve action' });
  });
});

router.post('/actions/:id/reject', (req: AuthenticatedRequest, res: Response) => {
  resolveAction(req, res, 'rejected').catch((err) => {
    logger.error('[SOAR API] reject failed', errorContext(err));
    res.status(500).json({ error: 'Failed to reject action' });
  });
});

export default router;
