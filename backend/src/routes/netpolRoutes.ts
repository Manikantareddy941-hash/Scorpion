import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { generateNetworkPolicies } from '../netpol/networkPolicyGenerator';
import { openNetpolPr } from '../netpol/netpolPr';
import { requireRole } from '../middleware/requireRole';
import { logger, errorContext, errorMessage } from '../services/logger';

const generateSchema = z.object({
  namespace: z.string().min(1).max(63).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  flows: z.array(z.object({
    from: z.string().min(1).max(63),
    to: z.string().min(1).max(63),
    port: z.number().int().min(1).max(65535),
  })).max(100),
  createPr: z.boolean().optional(),
  repo: z.string().url().optional(),
}).refine((v) => !v.createPr || Boolean(v.repo), {
  message: 'repo is required when createPr is true',
  path: ['repo'],
});

const router = Router();
router.use(requireRole('admin', 'security'));

router.post('/generate', async (req: Request, res: Response) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { namespace, flows, createPr, repo } = parsed.data;

  try {
    let yaml: string;
    try {
      yaml = generateNetworkPolicies({ namespace, flows });
    } catch (err) {
      // Defense-in-depth: the zod namespace regex above should fully guard the
      // generator's DNS_1123 check, so this branch is a safety net, not the
      // primary boundary. Echoing the message is safe here — it is the
      // generator's single static throw text, never derived from user input.
      const msg = errorMessage(err);
      if (msg.startsWith('Invalid namespace')) {
        return res.status(400).json({ error: msg });
      }
      throw err; // anything else is a real failure — fall to the outer 500
    }

    if (!createPr || !repo) return res.json({ yaml });

    try {
      const { prUrl } = await openNetpolPr({ repo, namespace, yaml });
      return res.json({ yaml, prUrl });
    } catch (err) {
      // The artifact is still useful even when the PR fails — return both.
      const msg = errorMessage(err);
      logger.error('[NetPol API] PR failed:', { event: 'NETPOL_PR_FAILED', ...errorContext(err) });
      return res.json({ yaml, prError: msg });
    }
  } catch (err) {
    logger.error('[NetPol API] generate failed', errorContext(err));
    return res.status(500).json({ error: 'Failed to generate network policies' });
  }
});

export default router;
