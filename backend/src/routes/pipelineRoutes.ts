import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { databases, COLLECTIONS, DB_ID, ID, Query } from '../lib/appwrite';
import rateLimit from 'express-rate-limit';
import { verifyUser } from '../middleware/auth';
import { runPipeline, registerSseClient, unregisterSseClient, PipelineLogger, triggerPipelineRun } from '../services/pipelineService';

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
router.get('/runs', verifyUser, async (req: Request, res: Response) => {
  try {
    const { repoId, status, limit = 50 } = req.query;

    const queries: string[] = [
      Query.orderDesc('$createdAt'),
      Query.limit(Number(limit))
    ];

    if (repoId) queries.push(Query.equal('repoId', String(repoId)));
    if (status) queries.push(Query.equal('status', String(status)));

    const runs = await databases.listDocuments(DB_ID, 'pipeline_runs', queries);
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch pipeline runs', details: err.message });
  }
});

/**
 * GET /api/pipelines/run/:runId
 * Fetch single pipeline run
 */
router.get('/run/:runId', verifyUser, async (req: Request, res: Response) => {
  try {
    const run = await databases.getDocument(DB_ID, 'pipeline_runs', req.params.runId);
    res.json(run);
  } catch (err: any) {
    res.status(404).json({ error: 'Pipeline run not found', details: err.message });
  }
});

/**
 * GET /api/pipelines/run/:runId/logs
 * Read logs file from disk
 */
router.get('/run/:runId/logs', verifyUser, async (req: Request, res: Response) => {
  try {
    const pipeLogger = new PipelineLogger(req.params.runId);
    const logs = await pipeLogger.getLogs();
    res.type('text/plain').send(logs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve logs', details: err.message });
  }
});

/**
 * GET /api/pipelines/run/:runId/stream
 * SSE endpoint for live updates
 */
router.get('/run/:runId/stream', verifyUser, (req: Request, res: Response) => {
  const { runId } = req.params;

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
router.post('/trigger', verifyUser, triggerLimiter, async (req: Request, res: Response) => {
  try {
    const { repoId, branch = 'main' } = req.body;
    const userEmail = (req as any).user?.email || 'unknown';

    if (!repoId) {
      return res.status(400).json({ error: 'repoId is required' });
    }

    // Ensure repository document exists; create minimal entry if missing
    try {
      await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
    } catch {
      await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId, {
        name: req.body.repoName || repoId,
        url: req.body.cloneUrl || '',
        user_id: 'system',
        created_at: new Date().toISOString(),
      });
    }

    const runId = await triggerPipelineRun(
      repoId,
      branch,
      'MANUAL',
      'Manually triggered from Scorpion Console',
      userEmail
    );

    res.status(202).json({
      message: 'Pipeline run successfully triggered',
      runId
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to trigger pipeline run', details: err.message });
  }
});

export default router;
