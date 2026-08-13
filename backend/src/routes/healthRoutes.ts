import express, { Request, Response } from 'express';
import { databases, DB_ID } from '../lib/appwrite';
import { checkTool } from '../utils/toolCheck';
import { isWorkerRunning } from '../workers/scanWorker';
import { Query } from 'node-appwrite';
import { logger, errorContext } from '../services/logger';

const router = express.Router();

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
    // Health is typically the most exposed route on a deployment — often
    // unauthenticated and probed by anything that can reach the host — so the
    // dependency failure text is exactly what should not be in the body.
    logger.error('[Health] check failed', { event: 'HEALTH_CHECK_FAILED', ...errorContext(err) });
    res.status(500).json({
        status: 'error',
        message: 'Health check failed'
    });
  }
});

export default router;
