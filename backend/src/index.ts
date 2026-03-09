import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient, User } from '@supabase/supabase-js';

import authRoutes from './routes/authRoutes';
import projectRoutes from './routes/projectRoutes';
import uploadRoutes from './routes/uploadRoutes';
import healthRoutes from './routes/healthRoutes';

import { triggerScan, getInsightsSummary } from './services/scanService';
import { initScheduler } from './jobs/scheduler';

const app = express();
const port = process.env.PORT || 3001;

/* -------------------------------------------------------------------------- */
/*                                  MIDDLEWARE                                */
/* -------------------------------------------------------------------------- */

app.use(helmet());

app.use(
    cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true,
    })
);

app.use(express.json());

/* -------------------------------------------------------------------------- */
/*                                RATE LIMITERS                               */
/* -------------------------------------------------------------------------- */

const scanLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many scan requests. Try again in 1 minute.' },
});

/* -------------------------------------------------------------------------- */
/*                              SUPABASE CLIENT                               */
/* -------------------------------------------------------------------------- */

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AuthenticatedRequest extends Request {
    user?: User;
}

/* -------------------------------------------------------------------------- */
/*                              AUTH MIDDLEWARE                               */
/* -------------------------------------------------------------------------- */

const authenticate = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Missing token' });

        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user)
            return res.status(401).json({ error: 'Invalid or expired token' });

        req.user = data.user;
        next();
    } catch (err) {
        next(err);
    }
};

/* -------------------------------------------------------------------------- */
/*                                  ROUTES                                    */
/* -------------------------------------------------------------------------- */

app.use('/auth', authRoutes);
app.use('/api/projects', authenticate, projectRoutes);
app.use('/api/upload', authenticate, uploadRoutes);
app.use('/api', healthRoutes);

/* ------------------------------ TRIGGER SCAN ------------------------------ */

app.post(
    '/api/repos/:id/scan',
    authenticate,
    scanLimiter,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const { scanId, error } = await triggerScan(req.params.id);

            if (error) return res.status(400).json({ error });

            res.json({
                scanId,
                message: 'Scan triggered successfully',
            });
        } catch (err) {
            next(err);
        }
    }
);

/* --------------------------- INSIGHTS SUMMARY ----------------------------- */

app.get(
    '/api/insights/summary',
    authenticate,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const summary = await getInsightsSummary(req.user!.id);
            res.json(summary);
        } catch (err) {
            next(err);
        }
    }
);

/* -------------------------------------------------------------------------- */
/*                              GLOBAL ERROR HANDLER                          */
/* -------------------------------------------------------------------------- */

app.use(
    (err: any, _req: Request, res: Response, _next: NextFunction) => {
        console.error('❌ Error:', err?.message || err);
        res.status(500).json({
            error: err?.message || 'Internal Server Error',
        });
    }
);

/* -------------------------------------------------------------------------- */
/*                              BACKGROUND JOBS                               */
/* -------------------------------------------------------------------------- */

initScheduler();

/* -------------------------------------------------------------------------- */
/*                                START SERVER                                */
/* -------------------------------------------------------------------------- */

app.listen(port, () => {
    console.log(`🚀 Backend running on http://localhost:${port}`);
});