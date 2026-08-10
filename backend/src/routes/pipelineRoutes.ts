import { Router, Request, Response } from 'express';
import { databases, COLLECTIONS, DB_ID, Query } from '../lib/appwrite';
import rateLimit from 'express-rate-limit';
import { verifyUser } from '../middleware/auth';
import { registerSseClient, unregisterSseClient, PipelineLogger, triggerPipelineRun } from '../services/pipelineService';
import { canAccessResource } from '../services/tenancyService';
import { PipelineRunDocument } from '../types/pipeline.types';

interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: { $id: string; email?: string };
}

const router = Router();

// Rate limiter for pipeline trigger endpoint: max 5 requests per minute
const triggerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});


/**
 * GET /api/pipelines/runs
 * List all pipeline runs
 */
router.get('/runs', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id;
    const { repoId, status, limit = 50 } = req.query;

    if (repoId) {
      // Single repo requested: verify the caller can access it before scoping to it.
      const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, String(repoId)).catch(() => null);
      if (!repo || !(await canAccessResource(repo, userId))) {
        return res.status(403).json({ error: 'You do not have access to this repository' });
      }
    }

    const queries: string[] = [
      Query.orderDesc('$createdAt'),
      Query.limit(Number(limit))
    ];

    if (repoId) {
      queries.push(Query.equal('repoId', String(repoId)));
    } else {
      // No repoId filter: scope to every repo the caller can access instead of
      // returning runs across the entire system.
      const ownedRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
        Query.equal('user_id', userId || ''),
        Query.limit(500),
      ]);
      const accessibleRepoIds = ownedRepos.documents.map(r => r.$id);
      if (accessibleRepoIds.length === 0) {
        return res.json({ total: 0, documents: [] });
      }
      queries.push(Query.equal('repoId', accessibleRepoIds));
    }
    if (status) queries.push(Query.equal('status', String(status)));

    const runs = await databases.listDocuments(DB_ID, 'pipeline_runs', queries);
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pipeline runs' });
  }
});

/**
 * GET /api/pipelines/run/:runId
 * Fetch single pipeline run
 */
// Verifies the caller can access the repo a pipeline run belongs to.
const canAccessRun = async (run: PipelineRunDocument, userId?: string): Promise<boolean> => {
  if (!run.repoId) return false;
  const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, run.repoId).catch(() => null);
  return !!repo && canAccessResource(repo, userId);
};

router.get('/run/:runId', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const run = await databases.getDocument<PipelineRunDocument>(DB_ID, 'pipeline_runs', req.params.runId);
    if (!(await canAccessRun(run, req.user?.$id))) {
      return res.status(403).json({ error: 'You do not have access to this pipeline run' });
    }
    res.json(run);
  } catch (err) {
    res.status(404).json({ error: 'Pipeline run not found' });
  }
});

/**
 * GET /api/pipelines/run/:runId/logs
 * Read logs file from disk
 */
router.get('/run/:runId/logs', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const run = await databases.getDocument<PipelineRunDocument>(DB_ID, 'pipeline_runs', req.params.runId);
    if (!(await canAccessRun(run, req.user?.$id))) {
      return res.status(403).json({ error: 'You do not have access to this pipeline run' });
    }

    const pipeLogger = new PipelineLogger(req.params.runId);
    const logs = await pipeLogger.getLogs();
    res.type('text/plain').send(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve logs' });
  }
});

/**
 * GET /api/pipelines/run/:runId/stream
 * SSE endpoint for live updates
 */
router.get('/run/:runId/stream', verifyUser, async (req: AuthenticatedRequest, res: Response) => {
  const { runId } = req.params;

  try {
    const run = await databases.getDocument<PipelineRunDocument>(DB_ID, 'pipeline_runs', runId);
    if (!(await canAccessRun(run, req.user?.$id))) {
      return res.status(403).json({ error: 'You do not have access to this pipeline run' });
    }
  } catch {
    return res.status(404).json({ error: 'Pipeline run not found' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send an initial handshake comment
  res.write(': sse handshake\n\n');

  registerSseClient(runId, res);

  req.on('close', () => {
    unregisterSseClient(runId, res);
  });
});

/**
 * POST /api/pipelines/trigger
 * Manually trigger a pipeline run
 */
router.post('/trigger', verifyUser, triggerLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { repoId, branch = 'main' } = req.body;
    const userEmail = req.user?.email || 'unknown';

    if (!repoId) {
      return res.status(400).json({ error: 'repoId is required' });
    }

    const userId = req.user?.$id;

    // Ensure repository document exists; create minimal entry if missing. If it
    // already exists, the caller must actually have access to it.
    try {
      const existingRepo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
      if (!(await canAccessResource(existingRepo, userId))) {
        return res.status(403).json({ error: 'You do not have access to this repository' });
      }
    } catch {
      // No `|| 'system'` fallback: a repo owned by 'system' belongs to no
      // tenant, so canAccessResource denies everyone — including this caller,
      // who would then be unable to read the run they just started. verifyUser
      // guarantees a session, so an absent id here is a real fault.
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required to create a repository' });
      }
      await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
        name: req.body.repoName || repoId,
        url: req.body.cloneUrl || '',
        user_id: userId,
        created_at: new Date().toISOString(),
      });
    }

    const runId = await triggerPipelineRun(
      repoId,
      branch,
      'MANUAL',
      'Manually triggered from Scorpion Console',
      userEmail,
      req.body.repoName,
      req.body.cloneUrl,
      // Owner for the repo-create fallback inside triggerPipelineRun. The
      // block above normally creates it first; this covers the race where the
      // repository disappears in between.
      userId
    );

    res.status(202).json({
      message: 'Pipeline run successfully triggered',
      runId
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger pipeline run' });
  }
});

export default router;
