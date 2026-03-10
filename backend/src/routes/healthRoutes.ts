import express, { Request, Response } from 'express';

const router = express.Router();

import { checkSupabaseConnection } from '../lib/supabase';
import { checkTool } from '../utils/toolCheck';

router.get('/health', async (req: Request, res: Response) => {
  try {
    const { ok, error } = await checkSupabaseConnection();
    res.status(200).json({
      status: 'ok',
      service: 'stackpilot-backend',
      timestamp: new Date().toISOString(),
      database: ok ? 'healthy' : `disconnected: ${error}`
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Health check failed' });
  }
});

router.get('/health/auth', async (req: Request, res: Response) => {
  try {
    const { ok, error } = await checkSupabaseConnection();
    const tools = {
      gitleaks: checkTool('gitleaks'),
      trivy: checkTool('trivy'),
      semgrep: checkTool('semgrep')
    };

    res.json({
      backend: 'ok',
      supabase: ok ? 'ok' : 'fail',
      supabaseError: error || null,
      env: {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
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
