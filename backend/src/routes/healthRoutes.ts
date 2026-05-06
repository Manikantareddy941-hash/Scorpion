import express, { Request, Response } from 'express';
import { databases, DB_ID } from '../lib/appwrite';
import { checkTool } from '../utils/toolCheck';
import { isWorkerRunning } from '../workers/scanWorker';
import { Query } from 'node-appwrite';

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
    
  } catch (err: any) {
    res.status(500).json({ 
        status: 'error', 
        message: 'Health check failed',
        error: err.message
    });
  }
});

export default router;
