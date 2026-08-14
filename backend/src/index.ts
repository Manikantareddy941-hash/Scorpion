import './utils/telemetry';
import dotenv from "dotenv";
dotenv.config();
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initScheduler } from './scheduler';
import { databases, DB_ID, COLLECTIONS, Query, ID } from './lib/appwrite';
import { Models, Client as AppwriteClient, Account as AppwriteAccount } from 'node-appwrite';
import { logger, errorMessage, errorContext } from './services/logger';
import { redactUrl } from './utils/redactUrl';
import { requestLogger } from './middleware/requestLogger';

// Route Imports
import authRoutes from './routes/authRoutes';
import ssoRoutes from './routes/ssoRoutes';
import projectRoutes from './routes/projectRoutes';
import uploadRoutes from './routes/uploadRoutes';
import { isPostgresEnabled, getPool, closePool } from './db/pool';
import healthRoutes from './routes/healthRoutes';
import repoRoutes from './routes/repoRoutes';
import policyRoutes from './routes/policyRoutes';
import notificationRoutes from './routes/notificationRoutes';
import taskRoutes from './routes/taskRoutes';
import findingRoutes from './routes/findingRoutes';
import chatRoutes from './routes/chatRoutes';
import metricsRoutes from './routes/metricsRoutes';
import teamRoutes from './routes/teamRoutes';
import ciRoutes from './routes/ciRoutes';
import incidentRoutes from './routes/incidentRoutes';
import complianceRoutes from './routes/complianceRoutes';
import insightRoutes from './routes/insightRoutes';
import userRoutes from './routes/userRoutes';
import keyRoutes from './routes/keyRoutes';
import reportRoutes from './routes/reportRoutes';
import aiRoutes from './routes/aiRoutes';
import webhookRoutes from './routes/webhookRoutes';
import remediationRouter from './routes/remediation';
import analyticsRoutes from './routes/analyticsRoutes';
import alertRoutes from './routes/alerts';
import vulnRoutes from './routes/vulnRoutes';
import sbomRouter from './routes/sbomRoute';
import ideRoutes from './routes/ideRoutes';
import gitopsRoutes from './routes/gitopsRoutes';
import falcoRoutes from './routes/falcoRoutes';
import threatsRouter from './routes/threats';
import auditRoutes from './routes/auditRoutes';
import remediateRouter from './routes/remediate';
import dashboardRoutes from './routes/dashboardRoutes';
import gateRoutes from './routes/gateRoutes';
import terminalRoutes from './routes/terminalRoutes';
import dockerScanRoutes from './routes/dockerScanRoutes';
import dastRoutes from './routes/dastRoutes';
import nucleiRoutes from './routes/nucleiRoutes';
import ffufRoutes from './routes/ffufRoutes';
import scanRoutes from './routes/scanRoutes';
import monitorRoutes from './routes/monitorRoutes';
import monitorCorrelationRoutes from './routes/monitorCorrelationRoutes';
import monitorFeedbackRoutes from './routes/monitorFeedbackRoutes';
import monitorSuppressionRoutes from './routes/monitorSuppressionRoutes';
import issuesRoutes from './routes/issuesRoutes';
import buildRoutes from './routes/buildRoutes';
import deployRoutes from './routes/deployRoutes';
import pipelineRoutes from './routes/pipelineRoutes';
import planRoutes from './routes/planRoutes';
import securityRequirementsRoutes from './routes/securityRequirementsRoutes';
import threatModelRoutes from './routes/threatModelRoutes';
import k8sAdmissionRoutes from './routes/k8sAdmission';
import ingestRoutes from './routes/ingestRoutes';
import ciTokenRoutes from './routes/ciTokenRoutes';
import gateRulesRoutes from './routes/gateRulesRoutes';
import autotuneRoutes from './routes/autotuneRoutes';
import driftRoutes from './routes/driftRoutes';
import canaryRoutes from './routes/canaryRoutes';
import soarRoutes from './routes/soarRoutes';
import falcoRuleRoutes from './routes/falcoRuleRoutes';
import postureRoutes from './routes/postureRoutes';
import netpolRoutes from './routes/netpolRoutes';
import iacRoutes from './routes/iacRoutes';
import { registerTicketRoutes } from './registerRoutes';
import crypto from 'crypto';
import https from 'https';
import fs from 'fs';
import { createNodeMiddleware } from "@octokit/webhooks";
import githubWebhooks from "./github/webhookHandler";
import { initScanWorker } from './workers/scanWorker';
import { initAuditVerifyWorker } from './workers/auditVerifyWorker';
import { initScanQueueWorker } from './queues/scanQueueWorker';
import { initReportQueueWorker } from './queues/reportQueueWorker';
import { reportQueue } from './queues/reportQueue';
import { initDastQueueWorker } from './queues/dastQueueWorker';
import { initNucleiQueueWorker } from './queues/nucleiQueueWorker';
import { initFfufQueueWorker } from './queues/ffufQueueWorker';
import { initCanaryQueueWorker } from './queues/canaryQueueWorker';
import { initSoarQueueWorker } from './queues/soarQueueWorker';
import { startCorrelationWorker, stopCorrelationWorker } from './queues/correlationQueueWorker';
import { enqueueCorrelationTick, correlationQueue } from './queues/correlationQueue';
import { startDriftMonitor } from './workers/driftMonitor';
import { startPostureScanner } from './workers/postureScanner';
import { startFallbackReplayer, stopFallbackReplayer } from './workers/fallbackReplayer';
import { scanQueue } from './queues/scanQueue';
import { dastQueue } from './queues/dastQueue';
import { nucleiQueue } from './queues/nucleiQueue';
import { ffufQueue } from './queues/ffufQueue';
import { canaryQueue } from './queues/canaryQueue';
import { soarQueue } from './queues/soarQueue';
import { redisConnection } from './queues/redisConnection';

// --- Startup Diagnostic ---
logger.info('🚀 [Startup] System Diagnostic Initiated');

const requiredEnv = [
    'APPWRITE_ENDPOINT',
    'APPWRITE_PROJECT_ID',
    'APPWRITE_API_KEY',
    'APPWRITE_DATABASE_ID',
    'FRONTEND_URL'
];

requiredEnv.forEach(env => {
    if (!process.env[env]) logger.warn(`⚠️  [Startup] WARNING: Missing environment variable "${env}"`);
    else logger.info(`✅ [Startup] Environment variable "${env}" is configured`);
});

import { validateTools } from './services/scan/orchestrator';
import { initToolCache } from './utils/toolCheck';
import { probeSigningReadiness } from './services/cosignService';
import { signingConfigBroken } from './services/metrics';

(async () => {
    logger.info("🛡️  Security Tool Chain Diagnostic:");
    await initToolCache();
    await validateTools();

    // Report the signature path's readiness at boot rather than at the first
    // blocked release. Non-fatal by design, and silent on installs that never
    // configured signing — see probeSigningReadiness for why it stays quiet.
    //
    // The gauge is set here rather than inside probeSigningReadiness so that
    // cosignService stays free of a metrics import: metrics.ts starts a 15s
    // setInterval at module load, and pulling that into cosignService would leak
    // a timer into every suite that imports it. The composition root is the right
    // place to decide what a verdict is worth telling Prometheus.
    await probeSigningReadiness()
        .then((readiness) => signingConfigBroken.set(readiness === 'degraded' ? 1 : 0))
        .catch((err: unknown) =>
            logger.warn('[Cosign] Signing readiness probe failed to run', {
                event: 'SIGNING_READINESS_PROBE_FAILED', ...errorContext(err),
            }),
        );

    // --- Recovery Mechanism ---
    try {
        logger.info('🔄 [Recovery] Checking for stalled scans...');
        if (COLLECTIONS.SCANS) {
            const stalledScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.equal('status', 'running'),
                Query.limit(50) // Adjust if expecting high volumes
            ]);

            for (const scan of stalledScans.documents) {
                logger.info(JSON.stringify({
                    scanId: scan.$id,
                    repoId: scan.repo_id,
                    stage: 'fail_recovery',
                    timestamp: new Date().toISOString(),
                    status: 'failed',
                    error: 'System restart aborted running scan',
                    stack: null
                }));
                await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scan.$id, {
                    status: 'failed',
                    completedAt: new Date().toISOString(),
                    details: JSON.stringify({ error: 'System restart aborted running scan' })
                });
            }
            if (stalledScans.total > 0) {
                logger.info(`✅ [Recovery] Recovered ${stalledScans.total} stalled scans.`);
            } else {
                logger.info(`✅ [Recovery] No stalled scans found.`);
            }
        }
    } catch (err) {
        logger.error('❌ [Recovery] Failed to run crash recovery:', { event: 'CRASH_RECOVERY_FAILED', ...errorContext(err) });
    }
})();

const app = express();
const port = process.env.PORT || 3001;

// Trust the first proxy (nginx/load balancer). Without this, req.ip is the
// proxy's address — which breaks per-client rate limiting (every request keys to
// the proxy) and audit/IP logging behind a reverse proxy.
app.set('trust proxy', 1);

// Force HTTPS in production. TLS itself is terminated by the reverse proxy/load
// balancer in front of this service (this app never holds a cert) — this just
// rejects/redirects any request that proxy reports as plain HTTP.
if (process.env.NODE_ENV === 'production') {
    app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
        // Not redacted: this is the redirect target, not a log line. Rewriting
        // it would send the caller to a nonexistent path.
        res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    });
}

// --- Middleware ---
// Structured JSON request logging (winston) in place of morgan, so HTTP access
// logs share the app's logger/transports and parse cleanly in the log pipeline.
app.use(requestLogger);
// helmet sets secure response headers (X-Frame-Options, X-Content-Type-Options,
// etc.). HSTS is made explicit so browsers pin HTTPS for a year once served over TLS.
app.use(helmet({
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));
// Explicit origin allowlist: the deployed frontend, plus any extra origins
// (staging/preview deployments) via comma-separated ALLOWED_ORIGINS.
const allowedOrigins = [process.env.FRONTEND_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')]
    .map(o => o?.trim())
    .filter((o): o is string => !!o);

app.use(cors({
    origin: (origin, callback) => {
        // Same-origin/non-browser requests (curl, server-to-server) send no Origin header
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY', 'X-USER-ID', 'X-TENANT-ID', 'X-Active-Team-Id']
}));
// --- GitHub Webhook (MUST be before express.json() for raw body access) ---
app.use('/api/github/webhook', createNodeMiddleware(githubWebhooks, { path: '/api/github/webhook' }));

// Capture the raw body so HMAC-signed webhooks (GitHub) can verify against the
// exact bytes GitHub signed, not a re-serialized copy. Re-stringifying the parsed
// body changes whitespace/encoding and breaks signature verification.
app.use(express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; }
}));

// --- Rate Limiting ---
// Baseline per-IP ceiling across the whole API to blunt scraping / bot hammering.
// Generous enough for normal dashboard polling (a few requests every few seconds);
// cost-/abuse-sensitive routes layer their own tighter limiters on top.
const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please slow down.',
    handler: (req: Request, res: Response) => {
        logger.warn(`[RateLimit] IP ${req.ip} exceeded global limit on ${req.method} ${redactUrl(req.originalUrl)}`);
        res.status(429).json({ error: 'Too many requests, please slow down.' });
    }
});
app.use('/api', globalApiLimiter);

const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    handler: (req: Request, res: Response) => {
        logger.warn(`[RateLimit] IP ${req.ip} exceeded auth limit on ${req.method} ${redactUrl(req.originalUrl)}`);
        res.status(429).json({ error: 'Too many requests, please slow down.' });
    }
});

// --- Authentication Middleware ---
interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        logger.warn(`[Auth] Missing authorization header for ${req.method} ${redactUrl(req.originalUrl)} from ${req.ip}`);
        return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const client = new AppwriteClient()
            .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
            .setProject(process.env.APPWRITE_PROJECT_ID || '')
            .setJWT(token);

        const account = new AppwriteAccount(client);
        const user = await account.get();
        if (!user) {
            logger.warn(`[Auth] Invalid token for ${req.method} ${redactUrl(req.originalUrl)} from ${req.ip}`);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    } catch (err) {
        if (isAppwriteError(err) && err.code === 401) {
            logger.warn(`[Auth] Rejected expired/invalid token for ${req.method} ${redactUrl(req.originalUrl)} from ${req.ip}`);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
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
app.use('/auth/sso', authLimiter, ssoRoutes);
app.use('/api', healthRoutes);
app.use('/api/projects', authenticate, projectRoutes);
app.use('/api/upload', authenticate, uploadRoutes);
app.use('/api/repos', authenticate, repoRoutes);
app.use('/api/policies', authenticate, policyRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/tasks', authenticate, taskRoutes);
app.use('/api/chat', authenticate, chatRoutes);
app.use('/api/findings', authenticate, findingRoutes);
app.use('/api/teams', authenticate, teamRoutes);
app.use('/api/ci', authenticateApiKey, ciRoutes);
app.use('/api/insights', authenticate, insightRoutes);
app.use('/api/user', authenticate, userRoutes);
app.use('/api/keys', authenticate, keyRoutes);
app.use('/api/ci-tokens', authenticate, ciTokenRoutes);
app.use('/api/reports', authenticate, reportRoutes);
app.use('/api/ai', authenticate, aiRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/remediation', authenticate, remediationRouter);
app.use('/api/remediate', authenticate, remediateRouter);
app.use('/api/vulns', authenticate, vulnRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/alerts', authenticate, alertRoutes);
app.use('/api/sbom', authenticate, sbomRouter);
app.use('/api/scan/ide', ideRoutes);
app.use('/api/gitops', gitopsRoutes);
app.use('/api/runtime', falcoRoutes);
app.use('/api/threats', threatsRouter);
app.use('/api/incidents', authenticate, incidentRoutes);
app.use('/api/compliance', authenticate, complianceRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/gates', gateRoutes);
// Scorpion Terminal. Behind `authenticate` like every other user-facing route —
// there is no second auth path for this surface, and no shell behind it: input is
// tokenised and looked up in a fixed verb table. See services/terminal/commands.ts.
app.use('/api/terminal', authenticate, terminalRoutes);
app.use('/api/v1/rules', authenticate, gateRulesRoutes);
// Auto-tune proposals. Authenticated and user-scoped: nothing here can reach the
// cluster-wide 'system' gate config.
app.use('/api/autotune', authenticate, autotuneRoutes);
app.use('/api/v1/drift', authenticate, driftRoutes);
app.use('/api/canary', authenticate, canaryRoutes);
app.use('/api/soar', authenticate, soarRoutes);
app.use('/api/falco-rules', authenticate, falcoRuleRoutes);
app.use('/api/posture', authenticate, postureRoutes);
app.use('/api/netpol', authenticate, netpolRoutes);
app.use('/api/iac', authenticate, iacRoutes);
app.use('/api/scan', dockerScanRoutes);
app.use('/api/scan/manual', scanRoutes); // Using /manual to avoid conflict with /scan/docker
app.use('/api/scan/dast', dastRoutes);
app.use('/api/scan', nucleiRoutes);
app.use('/api/scan', ffufRoutes);
app.use('/api/monitor', monitorRoutes);
app.use('/api/monitor/correlations', monitorCorrelationRoutes);
app.use('/api/monitor/feedback', monitorFeedbackRoutes);
app.use('/api/monitor/suppressions', monitorSuppressionRoutes);
app.use('/api/issues', authenticate, issuesRoutes);
app.use('/api/builds', authenticate, buildRoutes);
app.use('/api/deployments', authenticate, deployRoutes);
app.use('/api/deploy', authenticate, deployRoutes);
app.use('/api/pipelines', pipelineRoutes);
app.use('/api/plan', authenticate, planRoutes);
app.use('/api/plan', authenticate, securityRequirementsRoutes);
app.use('/api/threat-models', authenticate, threatModelRoutes);
// K8s ValidatingWebhook: called by the kube-apiserver, not an authenticated user — no auth middleware.
app.use('/api/v1/webhook', k8sAdmissionRoutes);
// CI scan-results ingestion, keyed by image digest (see ingestRoutes for the auth TODO).
app.use('/api/v1/ingest', ingestRoutes);
registerTicketRoutes(app);
app.use('/metrics', metricsRoutes);

// --- Ingestion APIs for Metrics & Logs ---
app.post('/api/metrics', async (req: Request, res: Response) => {
    try {
        const { repoId, cpu, memory, requestRate, deploymentId } = req.body;
        if (!repoId) return res.status(400).json({ error: 'repoId is required' });

        const doc = await databases.createDocument(DB_ID, 'metrics', ID.unique(), {
            repoId,
            deploymentId: deploymentId || '',
            cpu: Number(cpu || 0),
            memory: Number(memory || 0),
            requestRate: Number(requestRate || 0),
            timestamp: new Date().toISOString()
        });
        res.status(201).json(doc);
    } catch (err) {
        // repoId read off req.body: it is destructured inside the try, so the
        // local is not in scope here.
        logger.error('[Ingest] metrics write failed', {
            event: 'METRICS_INGEST_FAILED', repoId: req.body?.repoId, ...errorContext(err),
        });
        res.status(500).json({ error: 'Failed to record metrics' });
    }
});

app.post('/api/logs', async (req: Request, res: Response) => {
    try {
        const { repoId, log, level = 'info', deploymentId } = req.body;
        if (!repoId || !log) return res.status(400).json({ error: 'repoId and log are required' });

        const doc = await databases.createDocument(DB_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
            action: 'app_log',
            actor: 'application',
            actorEmail: 'app@scorpion.local',
            resource: 'deployment',
            resourceId: deploymentId || repoId,
            timestamp: new Date().toISOString(),
            details: JSON.stringify({ log, level, repoId })
        });
        res.status(201).json(doc);
    } catch (err) {
        logger.error('[Ingest] log write failed', {
            event: 'LOG_INGEST_FAILED', repoId: req.body?.repoId, ...errorContext(err),
        });
        res.status(500).json({ error: 'Failed to record log' });
    }
});

import { initReportScheduler } from './services/scheduleService';
import { initUptimeScheduler } from './services/monitorService';
import { isAppwriteError } from './utils/errorGuards';

// --- Initialization ---
initScheduler();
initReportScheduler();
initScanWorker();
// Consumes the schedules initScheduler() just registered. Without this the jobs
// would be created on time and never processed — and no alerts would look
// exactly like a clean ledger.
initAuditVerifyWorker();
const scanQueueWorker = initScanQueueWorker();
const dastQueueWorker = initDastQueueWorker();
const nucleiQueueWorker = initNucleiQueueWorker();
const ffufQueueWorker = initFfufQueueWorker();
const canaryQueueWorker = initCanaryQueueWorker();
const soarQueueWorker = initSoarQueueWorker();
const reportQueueWorker = initReportQueueWorker();
// stopCorrelationWorker() closes via its own module-level handle, so the return value here
// isn't needed (unlike canary/soar, which store the worker to call .close() directly).
startCorrelationWorker();
// Seeds the single app-global 'system' tick — the only tick that processes status-spike
// telemetry into apm incidents (see correlationQueueWorker's SYSTEM_OWNER gate). Per-owner
// ticks are seeded lazily from monitorCorrelationRoutes' GET / handler.
void enqueueCorrelationTick({ ownerUserId: 'system' }, 5000);
initUptimeScheduler();
// Continuous runtime drift monitor (undefined when no kube config is reachable).
const driftMonitor = startDriftMonitor();
// Continuous posture scanner (read-only cluster snapshot collection).
let postureTimer: NodeJS.Timeout | undefined;
try {
  postureTimer = startPostureScanner();
} catch (err) {
  logger.warn('[Startup] posture scanner initialization failed', {
    event: 'POSTURE_SCANNER_INIT_FAILED', nodeEnv: process.env.NODE_ENV, ...errorContext(err),
  });
}
// Periodically replays repo JSON fallback buffers back into Appwrite on recovery.
startFallbackReplayer();

// --- Error Handler ---
interface HttpError extends Error {
    status?: number;
    statusCode?: number;
}

const isHttpError = (err: unknown): err is HttpError => err instanceof Error;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const error = isHttpError(err) ? err : new Error(typeof err === 'string' ? err : 'Unknown error');
    logger.error(`[Error Handler] ${error.stack || error.message}`);
    const statusCode = (isHttpError(err) && (err.status || err.statusCode)) || 500;
    const isProd = process.env.NODE_ENV === 'production';
    res.status(statusCode).json({
        error: isProd ? 'Internal Server Error' : error.message,
        ...(isProd ? {} : { stack: error.stack })
    });
});

const httpServer = app.listen(port, () => {
    logger.info(`[Backend] HTTP service running on http://localhost:${port}`);
});

// Storage driver check. Fail-fast rationale: a half-up SaaS silently writing to
// the JSON fallback because DATABASE_URL is set but Postgres is unreachable is
// worse than a loud crash the orchestrator will restart.
if (isPostgresEnabled()) {
    getPool()
        .query('SELECT 1')
        .then(() => logger.info('[db] Postgres connected — storage driver: postgres'))
        .catch((err: unknown) => {
            // No DATABASE_URL as a correlator — it carries the password.
            logger.error('[db] DATABASE_URL is set but Postgres is unreachable — refusing to start', {
                event: 'DB_STARTUP_UNREACHABLE', ...errorContext(err),
            });
            process.exit(1);
        });
} else {
    logger.warn('[db] DATABASE_URL not set — running on legacy Appwrite/JSON storage');
}

// Optionally boot an HTTPS listener alongside HTTP for the K8s admission webhook,
// which the kube-apiserver calls directly over TLS (no terminating proxy in
// front). Enabled only when both TLS_CERT and TLS_KEY are set (paths to PEM
// files). The same Express `app` backs both listeners, so every route and the
// UI serve identically over HTTP and HTTPS.
const tlsCertPath = process.env.TLS_CERT;
const tlsKeyPath = process.env.TLS_KEY;
let httpsServer: https.Server | undefined;

if (tlsCertPath && tlsKeyPath) {
    const httpsPort = Number(process.env.TLS_PORT) || 8443;
    try {
        const credentials = {
            cert: fs.readFileSync(tlsCertPath),
            key: fs.readFileSync(tlsKeyPath),
        };
        httpsServer = https.createServer(credentials, app).listen(httpsPort, () => {
            logger.info(`[Backend] HTTPS service running on https://localhost:${httpsPort}`);
        });
    } catch (err: unknown) {
        // Fail closed: TLS was explicitly requested but the cert/key can't be
        // read. Don't silently fall back to HTTP-only — the admission webhook
        // (failurePolicy: Fail) depends on this TLS listener being up, and a
        // half-configured gate is worse than a loud crash.
        logger.error(`[Backend] TLS requested but cert/key unreadable: ${err instanceof Error ? errorMessage(err) : String(err)}`);
        process.exit(1);
    }
}

// --- Graceful Shutdown -------------------------------------------------------
// On SIGTERM (k8s pod termination) / SIGINT (Ctrl-C): stop accepting new
// connections, drain in-flight requests, halt the drift poll loop, and close all
// backing connections before exit. Idempotent and time-boxed so a hung drain can
// never wedge the process past its termination grace period.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15000;
let shuttingDown = false;

const gracefulShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return; // second signal during drain — ignore
    shuttingDown = true;
    logger.info(`[Shutdown] ${signal} received — draining...`);

    // Hard ceiling: if any close hangs, force-exit so the orchestrator isn't
    // left waiting past its grace period. unref() so the timer itself can't
    // keep the event loop alive once a clean shutdown completes.
    const forceExit = setTimeout(() => {
        logger.error('[Shutdown] Drain timed out — forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
        // 1. Halt drift polling, posture scanner, and the fallback replayer first so no new work
        //    starts mid-shutdown.
        driftMonitor?.stop();
        if (postureTimer) clearInterval(postureTimer);
        stopFallbackReplayer();

        // 2. Stop accepting new connections on both listeners; resolves once
        //    in-flight requests drain.
        const listeners = [httpServer, httpsServer].filter(
            (s): s is NonNullable<typeof s> => s !== undefined,
        );
        await Promise.all(
            listeners.map(
                (s) => new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve()))),
            ),
        );
        logger.info('[Shutdown] HTTP(S) listener(s) closed');

        // 3. Drain the BullMQ workers (waits for the active job), then the queues.
        await scanQueueWorker.close();
        await scanQueue.close();
        await dastQueueWorker.close();
        await dastQueue.close();
        await nucleiQueueWorker.close();
        await nucleiQueue.close();
        await ffufQueueWorker.close();
        await ffufQueue.close();
        await canaryQueueWorker.close();
        await canaryQueue.close();
        await soarQueueWorker.close();
        await soarQueue.close();
        await reportQueueWorker.close();
        await reportQueue.close();
        await stopCorrelationWorker();
        await correlationQueue.close();

        // 4. Close the Redis connection backing BullMQ.
        await redisConnection.quit();

        // 5. Close the Postgres pool (no-op when running on legacy storage).
        await closePool();

        // node-appwrite is a stateless HTTP client (no pooled socket to close);
        // there is nothing to release on the Appwrite side.

        clearTimeout(forceExit);
        logger.info('[Shutdown] Clean exit');
        process.exit(0);
    } catch (err: unknown) {
        logger.error(`[Shutdown] Error during shutdown: ${err instanceof Error ? errorMessage(err) : String(err)}`);
        clearTimeout(forceExit);
        process.exit(1);
    }
};

process.on('SIGTERM', (signal) => { void gracefulShutdown(signal); });
process.on('SIGINT', (signal) => { void gracefulShutdown(signal); });
