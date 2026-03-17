import dotenv from "dotenv";
dotenv.config();
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { initScheduler } from './jobs/scheduler';
import { databases, DB_ID, COLLECTIONS, Query } from './lib/appwrite';
import { Models, Client as AppwriteClient, Account as AppwriteAccount } from 'node-appwrite';

// Route Imports
import authRoutes from './routes/authRoutes';
import projectRoutes from './routes/projectRoutes';
import uploadRoutes from './routes/uploadRoutes';
import healthRoutes from './routes/healthRoutes';
import repoRoutes from './routes/repoRoutes';
import policyRoutes from './routes/policyRoutes';
import notificationRoutes from './routes/notificationRoutes';
import findingRoutes from './routes/findingRoutes';
import teamRoutes from './routes/teamRoutes';
import ciRoutes from './routes/ciRoutes';
import insightRoutes from './routes/insightRoutes';
import userRoutes from './routes/userRoutes';
import keyRoutes from './routes/keyRoutes';
import reportRoutes from './routes/reportRoutes';
import aiRoutes from './routes/aiRoutes';

import { checkTool } from './utils/toolCheck';
import crypto from 'crypto';

// --- Startup Diagnostic ---
console.log('🚀 [Startup] System Diagnostic Initiated');

const requiredEnv = [
    'APPWRITE_ENDPOINT',
    'APPWRITE_PROJECT_ID',
    'APPWRITE_API_KEY',
    'APPWRITE_DATABASE_ID',
    'FRONTEND_URL'
];

requiredEnv.forEach(env => {
    if (!process.env[env]) console.warn(`⚠️  [Startup] WARNING: Missing environment variable "${env}"`);
    else console.log(`✅ [Startup] Environment variable "${env}" is configured`);
});

(async () => {
    const tools = [
        { name: "SEMGREP", cmd: "semgrep" },
        { name: "GITLEAKS", cmd: "gitleaks" },
        { name: "TRIVY", cmd: "trivy" }
    ];
    console.log("🛡️  Security Tool Chain Diagnostic:");
    tools.forEach(t => console.log(`${checkTool(t.cmd) ? "✅" : "❌"} ${t.name}`));
})();

const app = express();
const port = process.env.PORT || 3001;

// --- Middleware ---
app.use(morgan('dev'));
app.use(helmet());
app.use(cors({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY']
}));
app.use(express.json());

// --- Rate Limiting ---
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
const scanLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 });

// --- Authentication Middleware ---
interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization header' });

    const token = authHeader.split(' ')[1];
    try {
        const client = new AppwriteClient()
            .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
            .setProject(process.env.APPWRITE_PROJECT_ID || '')
            .setJWT(token);

        const account = new AppwriteAccount(client);
        const user = await account.get();
        if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    } catch (err: any) {
        if (err?.code === 401) return res.status(401).json({ error: 'Invalid or expired token' });
        next(err);
    }
};

const authenticateApiKey = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) return res.status(401).json({ error: 'Missing X-API-KEY header' });

    try {
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.API_KEYS, [
            Query.equal('key_hash', keyHash),
            Query.limit(1)
        ]);

        if (response.total === 0) return res.status(401).json({ error: 'Invalid or expired API Key' });
        req.user = { $id: response.documents[0].user_id } as any;
        next();
    } catch (err) {
        next(err);
    }
};

// --- Routes ---
app.use('/auth', authLimiter, authRoutes);
app.use('/api', healthRoutes);
app.use('/api/projects', authenticate, projectRoutes);
app.use('/api/upload', authenticate, uploadRoutes);
app.use('/api/repos', authenticate, repoRoutes);
app.use('/api/policies', authenticate, policyRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/findings', authenticate, findingRoutes);
app.use('/api/teams', authenticate, teamRoutes);
app.use('/api/ci', authenticateApiKey, ciRoutes);
app.use('/api/insights', authenticate, insightRoutes);
app.use('/api/user', authenticate, userRoutes);
app.use('/api/keys', authenticate, keyRoutes);
app.use('/api/reports', authenticate, reportRoutes);
app.use('/api/ai', authenticate, aiRoutes);

// --- Initialization ---
initScheduler();

// --- Error Handler ---
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(`[Error Handler] ${err.stack || err.message}`);
    const statusCode = err.status || err.statusCode || 500;
    const isProd = process.env.NODE_ENV === 'production';
    res.status(statusCode).json({
        error: isProd ? 'Internal Server Error' : err.message,
        ...(isProd ? {} : { stack: err.stack })
    });
});

app.listen(port, () => {
    console.log(`[Backend] Service running on http://localhost:${port}`);
});
