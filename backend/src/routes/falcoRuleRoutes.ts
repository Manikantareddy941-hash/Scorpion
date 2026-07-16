import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { falcoRuleRepository } from '../repositories/falcoRuleRepository';
import { renderFalcoRules, FALCO_TEMPLATES, SAFE_PARAM } from '../runtime/falcoRuleCatalog';
import { requireRole } from '../middleware/requireRole';
import { logger } from '../services/logger';

const prioritySchema = z.enum(['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug']);

// Per brief: procs cap at 64 chars, domains/paths at 256 (FQDNs and container paths run long).
const safeStringArray = (maxLen: number) =>
  z.array(z.string().min(1).max(maxLen).regex(SAFE_PARAM, 'Invalid characters')).max(50).optional();

const ruleSchema = z.object({
  template: z.enum(['terminal-shell-in-container', 'outbound-unknown-domain', 'write-below-etc', 'sensitive-file-read', 'spawn-package-manager']),
  params: z.object({
    allowedProcs: safeStringArray(64),
    allowedDomains: safeStringArray(256),
    watchedPaths: safeStringArray(256),
  }),
  appScope: z.string().min(1).max(512).optional(),
  severityOverride: prioritySchema.optional(),
  suppressed: z.boolean(),
  enabled: z.boolean(),
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

const router = Router();
router.use(requireRole('admin', 'security'));

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rules = await falcoRuleRepository.listRules();
    res.json({ rules, templates: FALCO_TEMPLATES });
  } catch (err) {
    logger.error('[FalcoRules API] list failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to list rules' });
  }
});

router.get('/export', async (_req: Request, res: Response) => {
  try {
    const rules = await falcoRuleRepository.listRules();
    res.type('text/yaml').send(renderFalcoRules(rules));
  } catch (err) {
    logger.error('[FalcoRules API] export failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to render rules' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid rule', details: parsed.error.flatten() });
  }
  try {
    const rule = await falcoRuleRepository.createRule(parsed.data);
    res.status(201).json({ rule });
  } catch (err) {
    logger.error('[FalcoRules API] create failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

router.patch('/:id', async (req: Request<Record<string, string>>, res: Response) => {
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid rule update', details: parsed.error.flatten() });
  }
  try {
    await falcoRuleRepository.updateRule(req.params.id, parsed.data);
    res.json({ status: 'updated' });
  } catch (err) {
    logger.error('[FalcoRules API] update failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

export default router;
