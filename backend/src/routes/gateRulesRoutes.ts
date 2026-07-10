import { Router, Response, Request, NextFunction } from 'express';
import { Models } from 'node-appwrite';
import { z } from 'zod';
import { gateRulesRepository, GateConfig } from '../repositories/gateRulesRepository';
import { podSecurityRepository } from '../repositories/podSecurityRepository';
import {
  DEFAULT_POD_SECURITY_CONFIG,
  PodSecurityConfig,
  PodSecurityMode,
  PodSecurityRuleId,
} from '../services/podSecurityService';

interface AuthenticatedRequest extends Request {
  user?: Models.User<Models.Preferences>;
}

// Boundary validation — fail fast before anything reaches the repository.
const gateRuleSchema = z.object({
  id: z.string().min(1).max(128),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  threshold: z.number().int().min(0).max(1_000_000),
  action: z.enum(['block', 'warn']),
  enabled: z.boolean(),
});

const gateConfigSchema = z.object({
  rules: z.array(gateRuleSchema).max(100),
  env: z.enum(['dev', 'stage', 'prod']),
}) satisfies z.ZodType<GateConfig>;

const POD_SECURITY_RULE_IDS = [
  'registry-allowlist',
  'no-privileged',
  'run-as-non-root',
  'drop-dangerous-capabilities',
  'read-only-root-fs',
  'no-host-namespaces',
  'required-labels',
] as const;

const podSecurityConfigSchema = z.object({
  modes: z.record(z.enum(POD_SECURITY_RULE_IDS), z.enum(['enforce', 'audit', 'off'])),
  allowedRegistries: z.array(z.string().min(1).max(512)).max(50),
  requiredLabels: z.array(z.string().min(1).max(128)).max(50),
});

/** zod's enum-keyed record parses as a partial record — fill gaps from defaults
 *  so the stored config always carries a mode for every rule. */
function normalizePodSecurityConfig(parsed: z.infer<typeof podSecurityConfigSchema>): PodSecurityConfig {
  return {
    modes: { ...DEFAULT_POD_SECURITY_CONFIG.modes, ...(parsed.modes as Partial<Record<PodSecurityRuleId, PodSecurityMode>>) },
    allowedRegistries: parsed.allowedRegistries,
    requiredLabels: parsed.requiredLabels,
  };
}

const router = Router();

// GET /api/v1/rules/pod-security — cluster pod-security config (defaults if unsaved).
router.get('/pod-security', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const config = await podSecurityRepository.get(process.env.K8S_GATE_RULES_USER_ID || 'system');
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/rules/pod-security — replace the cluster pod-security config.
router.put('/pod-security', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = podSecurityConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid pod-security configuration', details: parsed.error.flatten() });
    }

    const saved = await podSecurityRepository.save(
      process.env.K8S_GATE_RULES_USER_ID || 'system',
      normalizePodSecurityConfig(parsed.data)
    );
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/rules — current user's gate configuration (defaults if unsaved).
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const config = await gateRulesRepository.get(userId);
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/rules — replace the current user's gate configuration.
router.put('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.$id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = gateConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid gate configuration', details: parsed.error.flatten() });
    }

    const saved = await gateRulesRepository.save(userId, parsed.data);
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

export default router;
