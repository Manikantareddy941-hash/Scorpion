import express, { Request, Response } from 'express';
import { databases, DB_ID } from '../lib/appwrite';
import { checkTool } from '../utils/toolCheck';

const router = express.Router();

router.get('/health', async (req: Request, res: Response) => {
  try {
    // Simple check to see if we can reach Appwrite
    await databases.listCollections(DB_ID);
    
    res.status(200).json({
      status: 'ok',
      service: 'stackpilot-backend',
      timestamp: new Date().toISOString(),
      database: 'healthy'
    });
  } catch (err: any) {
    res.status(500).json({ 
        status: 'error', 
        message: 'Health check failed',
        error: err.message
    });
  }
});

router.get('/health/auth', async (req: Request, res: Response) => {
  try {
    let appwriteStatus = 'ok';
    let appwriteError = null;
    
    try {
        await databases.listCollections(DB_ID);
    } catch (err: any) {
        appwriteStatus = 'fail';
        appwriteError = err.message;
    }

    const tools = {
      gitleaks: checkTool('gitleaks'),
      trivy: checkTool('trivy'),
      semgrep: checkTool('semgrep')
    };

    res.json({
      backend: 'ok',
      appwrite: appwriteStatus,
      appwriteError,
      env: {
        APPWRITE_ENDPOINT: !!process.env.APPWRITE_ENDPOINT,
        APPWRITE_PROJECT_ID: !!process.env.APPWRITE_PROJECT_ID,
        APPWRITE_API_KEY: !!process.env.APPWRITE_API_KEY,
        APPWRITE_DATABASE_ID: !!process.env.APPWRITE_DATABASE_ID,
        FRONTEND_URL: !!process.env.FRONTEND_URL
      },
      cors: process.env.FRONTEND_URL ? 'ok' : 'fail',
      tools
    });
  } catch (err) {
    res.status(500).json({ backend: 'fail' });
  }
});

export default router;
