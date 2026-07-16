import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  startCanary,
  abortCanary,
  CanaryAccessError,
  CanaryStateError,
} from '../gitops/canaryService';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: { $id: string };
}

const startCanarySchema = z.object({
  app: z.string().min(1).max(512),
  namespace: z.string().min(1).max(512),
  image: z.string().min(1).max(512),
  repo: z.string().min(1).max(512),
  stableRevision: z.string().min(1).max(512),
  canaryRevision: z.string().min(1).max(512),
  thresholds: z.object({
    maxErrorRatePct: z.number().min(0).max(100),
    maxP95LatencyMs: z.number().positive().optional(),
  }),
  intervalSec: z.number().int().min(10).max(3600),
  maxFailures: z.number().int().min(1).max(10),
  requiredChecks: z.number().int().min(1).max(100),
});

interface CanaryDocument {
  $id: string;
  $createdAt: string;
  user_id: string;
  checks: string;
  thresholds: string;
  [key: string]: unknown;
}

/** Stored JSON-string columns → parsed objects for the API response. */
function serializeCanary(doc: CanaryDocument) {
  return {
    ...doc,
    checks: JSON.parse(doc.checks || '[]') as unknown[],
    thresholds: JSON.parse(doc.thresholds || '{}') as Record<string, unknown>,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

const router = Router();

// POST /api/canary — start a canary analysis
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = startCanarySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid canary configuration', details: parsed.error.flatten() });
  }

  try {
    const { canaryId } = await startCanary({ ...parsed.data, userId });
    res.status(202).json({ canaryId, status: 'running' });
  } catch (err) {
    logger.error('[Canary API] start failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to start canary analysis' });
  }
});

// GET /api/canary — caller's canaries, newest first
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const list = await databases.listDocuments(DB_ID, COLLECTIONS.CANARIES, [
      Query.equal('user_id', userId),
      Query.orderDesc('$createdAt'),
      Query.limit(50),
    ]);
    res.json({ canaries: (list.documents as unknown as CanaryDocument[]).map(serializeCanary) });
  } catch (err) {
    logger.error('[Canary API] list failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to list canaries' });
  }
});

// GET /api/canary/:id — one canary with its check history
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const doc = (await databases.getDocument(DB_ID, COLLECTIONS.CANARIES, req.params.id)) as unknown as CanaryDocument;
    if (doc.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this canary' });
    }
    res.json(serializeCanary(doc));
  } catch {
    res.status(404).json({ error: 'Canary not found' });
  }
});

// POST /api/canary/:id/abort — stop analysis without a rollback PR
router.post('/:id/abort', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.$id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await abortCanary(req.params.id, userId);
    res.json({ status: 'aborted' });
  } catch (err) {
    if (err instanceof CanaryAccessError) return res.status(403).json({ error: err.message });
    if (err instanceof CanaryStateError) return res.status(409).json({ error: err.message });
    logger.error('[Canary API] abort failed:', errorMessage(err));
    res.status(500).json({ error: 'Failed to abort canary' });
  }
});

export default router;
