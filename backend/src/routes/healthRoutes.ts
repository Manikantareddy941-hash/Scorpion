import express, { Request, Response } from 'express';
import { databases, DB_ID } from '../lib/appwrite';
import { checkTool } from '../utils/toolCheck';
import { isWorkerRunning } from '../workers/scanWorker';
import { Query } from 'node-appwrite';
import { prisma } from '../services/prismaClient';

const router = express.Router();

/**
 * Readiness probe — gates traffic on the Postgres audit store being reachable.
 * Kept separate from /health (liveness): if the DB drops, K8s should stop
 * routing to this pod while it reconnects, NOT restart it (a restart can't fix
 * an upstream DB outage and just causes a crash loop). A lightweight `SELECT 1`
 * is enough to confirm the connection pool can hand out a live connection.
 */
router.get('/health/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready' });
  } catch (err: unknown) {
    res.status(503).json({
      status: 'not_ready',
      error: err instanceof Error ? err.message : 'database unreachable'
    });
  }
});

router.get('/health', async (req: Request, res: Response) => {
  try {
    // 1. Check Appwrite
    let appwriteHealthy = false;
    try {
        await databases.listDocuments(DB_ID, 'repositories', [Query.limit(1)]);
        appwriteHealthy = true;
    } catch (e) {
        appwriteHealthy = false;
    }

    // 2. Check Tools
    const services = {
        appwrite: appwriteHealthy,
        gitleaks: checkTool('gitleaks'),
        semgrep: checkTool('semgrep'),
        trivy: checkTool('trivy'),
        checkov: checkTool('checkov')
    };

    res.status(200).json({
      status: 'ok',
      services,
      worker: isWorkerRunning ? 'running' : 'stopped',
      timestamp: new Date().toISOString()
    });
    
  } catch (err: unknown) {
    res.status(500).json({
        status: 'error',
        message: 'Health check failed',
        error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

export default router;
