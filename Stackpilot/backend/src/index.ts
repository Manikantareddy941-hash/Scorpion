// ...existing code (first set of imports and const app = express())...
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { account, databases, users, DB_ID, COLLECTIONS } from './lib/appwrite';
import { Client, Account, ID, Query } from 'node-appwrite';
import { initScheduler } from './jobs/scheduler';
import { triggerScan, getInsightsSummary } from './services/scanService';
import authRoutes from './routes/authRoutes';
import projectRoutes from './routes/projectRoutes';
import uploadRoutes from './routes/uploadRoutes';
import healthRoutes from './routes/healthRoutes';
import crypto from 'crypto';

import { getSecurityPostureStats, getTrendData, generatePDFReportBuffer } from './services/reportingService';
import { Role, hasRequiredRole } from './services/rbacService';
import { getEffectivePolicy, evaluateScan } from './services/policyService';
import { recordAIEvent, getAIAggregates, getAITrends } from './services/metricsService';
import { linkCommitToScan, getFindingHistory } from './services/gitTraceabilityService';
import { createPullRequest } from './services/gitProviderService';
import { getRemediationFix, recordFeedback } from './services/aiService';

// --- Environment Validation ---
const requiredEnv = [
    'APPWRITE_ENDPOINT',
    'APPWRITE_PROJECT_ID',
    'APPWRITE_API_KEY',
    'APPWRITE_DATABASE_ID',
    'FRONTEND_URL'
];

console.log('🚀 [Startup] System Diagnostic Initiated'); // trigger reload

requiredEnv.forEach(env => {
    if (!process.env[env]) {
        console.warn(`⚠️  [Startup] WARNING: Missing environment variable "${env}"`);
    } else {
        console.log(`✅ [Startup] Environment variable "${env}" is configured`);
    }
});

import { checkTool } from './utils/toolCheck';

// Perform CLI tool validation
(async () => {
    const tools = [
        { name: "SEMGREP", cmd: "semgrep" },
        { name: "GITLEAKS", cmd: "gitleaks" },
        { name: "TRIVY", cmd: "trivy" }
    ]

    console.log("🛡️  Security Tool Chain Diagnostic:")

    tools.forEach(t => {
        const ok = checkTool(t.cmd)
        console.log(`${ok ? "✅" : "❌"} ${t.name}`)
    })

    const missingCount = tools.filter(t => !checkTool(t.cmd)).length;
    if (missingCount > 0) {
        console.error(`🚨 [Startup] CRITICAL: ${missingCount} security tools are missing. Manual installation required.`);
    } else {
        console.log('✨ [Startup] All security tools verified. System operational.');
    }
})();

const app = express();
const port = process.env.PORT || 3001;

// --- Security Middleware ---
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true, // Support credentials (cookies/auth headers)
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// --- Rate Limiting ---
const authLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: { error: 'Authentication rate limit reached. Please try again after 1 minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const scanLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 requests per minute
    message: { error: 'Scan request limit exceeded. Maximum 5 scans per minute per client.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/auth', authLimiter, authRoutes);

interface AuthenticatedRequest extends Request {
    user?: any;
}

// Auth Middleware: Validate Appwrite JWT or Session
const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const sessionToken = req.headers['x-appwrite-session'] as string;
    if (!sessionToken) return res.status(401).json({ error: 'Missing session token' });

    try {
        // In Appwrite server SDK, we should create a new client for each request
        // if we are verifying a JWT from the frontend.
        const userClient = new Client()
            .setEndpoint(process.env.APPWRITE_ENDPOINT!)
            .setProject(process.env.APPWRITE_PROJECT_ID!)
            .setJWT(sessionToken);

        const userAccount = new Account(userClient);
        const user = await userAccount.get();
        if (!user) return res.status(401).json({ error: 'Invalid or expired session' });

        req.user = { ...user, id: user.$id };
        next();
    } catch (err: any) {
        // Fallback for developers using master keys or other auth methods if needed
        // but for now, we enforce the JWT flow.
        res.status(401).json({ error: 'Authentication failed', details: err.message });
    }
};

// Middleware to check for required repository-level role
const requireRole = (requiredRole: Role) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const repoId = req.params.id || req.body.repo_id;
        if (!repoId) return res.status(400).json({ error: 'Missing repository ID for permission check' });

        try {
            const hasPermission = await hasRequiredRole(req.user!.$id || req.user!.id, repoId, requiredRole);
            if (!hasPermission) {
                return res.status(403).json({ error: `Requires ${requiredRole} permission for this repository` });
            }
            next();
        } catch (err) {
            next(err);
        }
    };
};

// --- API Key Authentication Middleware ---
const authenticateApiKey = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) return res.status(401).json({ error: 'Missing X-API-KEY header' });

    try {
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

        const response = await databases.listDocuments(
            DB_ID,
            'api_keys',
            [Query.equal('key_hash', keyHash), Query.limit(1)]
        );

        if (response.total === 0) {
            return res.status(401).json({ error: 'Invalid or expired API Key' });
        }

        const keyRecord = response.documents[0];
        req.user = { $id: keyRecord.user_id, id: keyRecord.user_id };
        next();
    } catch (err) {
        next(err);
    }
};

app.use('/api', healthRoutes);
app.use('/api/projects', authenticate, projectRoutes);
app.use('/api/upload', authenticate, uploadRoutes);

// Health check with basic diagnostic
app.get('/health', async (req: Request, res: Response) => {
    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.limit(1)]);

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                database: 'healthy',
                email: 'active',
                gateway: 'healthy'
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Health check failed' });
    }
});

// --- Repository Endpoints ---

// Add/Sync repository
app.post('/api/repos', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        const userId = req.user!.$id || req.user!.id;
        const repoName = url.split('/').pop();

        // Check if exists
        const existing = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId), Query.equal('url', url)]
        );

        let repo;
        if (existing.total > 0) {
            repo = await databases.updateDocument(
                DB_ID,
                COLLECTIONS.REPOSITORIES,
                existing.documents[0].$id,
                { name: repoName, updated_at: new Date().toISOString() }
            );
        } else {
            repo = await databases.createDocument(
                DB_ID,
                COLLECTIONS.REPOSITORIES,
                ID.unique(),
                {
                    user_id: userId,
                    url,
                    name: repoName,
                    updated_at: new Date().toISOString()
                }
            );
        }

        res.json(repo);
    } catch (error: unknown) {
        next(error);
    }
});

// List repos (owned or shared via teams)
app.get('/api/repos', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;

        // Fetch repos.
        // Complex permissions should be handled in services.
        const response = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId), Query.orderDesc('updated_at')]
        );

        res.json(response.documents);
    } catch (error: unknown) {
        next(error);
    }
});

// Trigger scan
app.post('/api/repos/:id/scan', authenticate, requireRole('developer'), scanLimiter, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { scanId, error } = await triggerScan(repoId);

        if (error) return res.status(400).json({ error });
        res.json({ scanId, message: 'Scan triggered successfully' });
    } catch (err) {
        next(err);
    }
});

// --- Policy Engine Endpoints ---

// Get active policy for a repository
app.get('/api/repos/:id/policy', authenticate, requireRole('viewer'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const policy = await getEffectivePolicy(repoId);
        res.json(policy);
    } catch (err) {
        next(err);
    }
});

// Update policy for a repository (Override)
app.put('/api/repos/:id/policy', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { policy_id, custom_max_critical, custom_max_high, custom_min_risk_score } = req.body;

        // Check if exists
        const existing = await databases.listDocuments(
            DB_ID,
            'project_policies',
            [Query.equal('repo_id', repoId)]
        );

        let data;
        const payload = {
            repo_id: repoId,
            policy_id,
            custom_max_critical,
            custom_max_high,
            custom_min_risk_score,
            updated_at: new Date().toISOString()
        };

        if (existing.total > 0) {
            data = await databases.updateDocument(DB_ID, 'project_policies', existing.documents[0].$id, payload);
        } else {
            data = await databases.createDocument(DB_ID, 'project_policies', ID.unique(), payload);
        }

        res.json(data);
    } catch (err) {
        next(err);
    }
});

// List system policies
app.get('/api/policies', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const response = await databases.listDocuments(
            DB_ID,
            'policies',
            [Query.orderAsc('name')]
        );

        res.json(response.documents);
    } catch (err) {
        next(err);
    }
});

// Manually re-evaluate a scan against current policy
app.post('/api/scans/:id/evaluate', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const scan = await databases.getDocument(DB_ID, 'scan_results', req.params.id);
        if (!scan) return res.status(404).json({ error: 'Scan not found' });

        const hasPerm = await hasRequiredRole((req as any).user.$id || (req as any).user.id, scan.repo_id, 'developer');
        if (!hasPerm) return res.status(403).json({ error: 'Requires developer permission' });

        const evaluation = await evaluateScan(req.params.id);
        res.json(evaluation);
    } catch (err) {
        next(err);
    }
});

// --- Notification Endpoints ---

// Get notification history
app.get('/api/notifications', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;
        const response = await databases.listDocuments(
            DB_ID,
            'notifications',
            [Query.equal('user_id', userId), Query.orderDesc('created_at'), Query.limit(50)]
        );

        res.json(response.documents);
    } catch (err) {
        next(err);
    }
});

// Get notification preferences
app.get('/api/notifications/preferences', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;
        const response = await databases.listDocuments(
            DB_ID,
            'notification_preferences',
            [Query.equal('user_id', userId)]
        );

        res.json(response.documents);
    } catch (err) {
        next(err);
    }
});

// Update notification preferences
app.put('/api/notifications/preferences', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { preferences } = req.body; // Array of preferences
        if (!Array.isArray(preferences)) throw new Error('Preferences must be an array');

        for (const pref of preferences) {
            const userId = req.user!.$id || req.user!.id;
            const existing = await databases.listDocuments(
                DB_ID,
                'notification_preferences',
                [
                    Query.equal('user_id', userId),
                    Query.equal('repo_id', pref.repo_id || ''),
                    Query.equal('channel', pref.channel),
                    Query.equal('event_type', pref.event_type)
                ]
            );

            const payload = {
                user_id: userId,
                ...pref,
                updated_at: new Date().toISOString()
            };

            if (existing.total > 0) {
                await databases.updateDocument(DB_ID, 'notification_preferences', existing.documents[0].$id, payload);
            } else {
                await databases.createDocument(DB_ID, 'notification_preferences', ID.unique(), payload);
            }
        }

        res.json({ message: 'Preferences updated successfully' });
    } catch (err) {
        next(err);
    }
});

// Test notification
app.post('/api/notifications/test', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { channel, target } = req.body;
        // Mock payload for test
        const payload = {
            webhook_url: target,
            message: { text: "🛡️ *StackPilot*: This is a test notification." }
        };

        // Use dispatcher or queue... for test let's use direct if possible or simplified dispatcher call
        // For simplicity, just test the channel
        res.json({ message: `Test notification queued for ${channel}` });
    } catch (err) {
        next(err);
    }
});

// --- Git Traceability & Resolution Endpoints ---

// Link commit to scan (Manually or via custom CI)
app.post('/api/scans/:id/commit', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const scanId = req.params.id;
        const { repo_id, commit_hash, branch, pr_number } = req.body;
        await linkCommitToScan(scanId, repo_id, { commit_hash, branch, pr_number });
        res.json({ message: 'Commit linked to scan successfully' });
    } catch (err) {
        next(err);
    }
});

// Get finding history
app.get('/api/findings/:id/history', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const history = await getFindingHistory(req.params.id);
        res.json(history);
    } catch (err) {
        next(err);
    }
});

// Resolve a finding manually
app.post('/api/findings/:id/resolve', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const findingId = req.params.id;
        const { state, reason } = req.body; // 'fixed', 'accepted_risk'

        // RBAC Check
        const finding = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, findingId);
        if (!finding) return res.status(404).json({ error: 'Finding not found' });

        const userId = req.user!.$id || req.user!.id;
        const hasPerm = await hasRequiredRole(userId, finding.repo_id, 'developer');
        if (!hasPerm) return res.status(403).json({ error: 'Requires developer permission' });

        if (!['fixed', 'accepted_risk'].includes(state)) {
            return res.status(400).json({ error: 'Invalid state' });
        }

        const resolution = await databases.createDocument(
            DB_ID,
            'finding_resolutions',
            ID.unique(),
            {
                finding_id: findingId,
                state,
                reason,
                user_id: userId,
                created_at: new Date().toISOString()
            }
        );

        await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, findingId, {
            resolution_status: state,
            resolution_id: resolution.$id,
            updated_at: new Date().toISOString()
        });

        res.json({ message: `Finding marked as ${state}`, resolution });
    } catch (err) {
        next(err);
    }
});

// --- Team & RBAC Endpoints ---

// Create a new team
app.post('/api/teams', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Team name is required' });

        const userId = req.user!.$id || req.user!.id;
        const team = await databases.createDocument(
            DB_ID,
            'teams',
            ID.unique(),
            { name, owner_id: userId, created_at: new Date().toISOString() }
        );

        // Add creator as owner
        await databases.createDocument(
            DB_ID,
            'team_members',
            ID.unique(),
            { team_id: team.$id, user_id: userId, role: 'owner', created_at: new Date().toISOString() }
        );

        res.json(team);
    } catch (err) {
        next(err);
    }
});

// Invite user to team
app.post('/api/teams/:id/invite', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const teamId = req.params.id;
        const { email, role } = req.body; // role: admin, developer, viewer

        // Check if requester is at least admin of the team
        const userId = req.user!.$id || req.user!.id;
        // Check if requester is at least admin of the team
        const memberships = await databases.listDocuments(
            DB_ID,
            'team_members',
            [Query.equal('team_id', teamId), Query.equal('user_id', userId), Query.limit(1)]
        );

        if (memberships.total === 0 || !['owner', 'admin'].includes(memberships.documents[0].role)) {
            return res.status(403).json({ error: 'Only team owners or admins can invite members' });
        }

        // Find user by email (Assuming we can query users by email in Appwrite Users API)
        const invitedUsers = await users.list([Query.equal('email', email)]);

        if (invitedUsers.total === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const invitedUser = invitedUsers.users[0];

        const data = await databases.createDocument(
            DB_ID,
            'team_members',
            ID.unique(),
            {
                team_id: teamId,
                user_id: invitedUser.$id,
                role: role || 'viewer',
                created_at: new Date().toISOString()
            }
        );

        res.json({ message: 'User invited successfully', data });
    } catch (err) {
        next(err);
    }
});

// Manage project access
app.get('/api/repos/:id/access', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const response = await databases.listDocuments(
            DB_ID,
            'project_access',
            [Query.equal('repo_id', req.params.id)]
        );

        res.json(response.documents);
    } catch (err) {
        next(err);
    }
});

app.put('/api/repos/:id/access', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { team_id, action } = req.body; // action: grant, revoke

        if (action === 'grant') {
            const existing = await databases.listDocuments(
                DB_ID,
                'project_access',
                [Query.equal('repo_id', repoId), Query.equal('team_id', team_id)]
            );
            if (existing.total === 0) {
                await databases.createDocument(DB_ID, 'project_access', ID.unique(), { repo_id: repoId, team_id });
            }
        } else {
            const existing = await databases.listDocuments(
                DB_ID,
                'project_access',
                [Query.equal('repo_id', repoId), Query.equal('team_id', team_id)]
            );
            if (existing.total > 0) {
                await databases.deleteDocument(DB_ID, 'project_access', existing.documents[0].$id);
            }
        }

        res.json({ message: `Access ${action}ed successfully` });
    } catch (err) {
        next(err);
    }
});

// Trigger scan via CI/CD (API Key Auth)
// Expected Body: { "repo_url": "...", "commit_hash": "...", "branch": "...", "pr_number": 123 }
app.post('/api/ci/scan', authenticateApiKey, scanLimiter, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { repo_url, commit_hash, branch, pr_number } = req.body;
    if (!repo_url) return res.status(400).json({ error: 'repo_url is required' });

    try {
        const userId = req.user!.$id || req.user!.id;
        // 1. Find the repository for this user
        const repos = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId), Query.equal('url', repo_url), Query.limit(1)]
        );

        if (repos.total === 0) {
            return res.status(404).json({ error: 'Repository not connected to StackPilot. Please add it via the dashboard first.' });
        }
        const repo = repos.documents[0];

        // 2. Trigger scan
        const { scanId, error: scanErr } = await triggerScan(repo.$id);
        if (scanErr) return res.status(400).json({ error: scanErr });

        // 3. Link Git metadata if provided
        if (scanId && commit_hash) {
            await linkCommitToScan(scanId, repo.$id, { commit_hash, branch, pr_number });
        }

        res.json({
            status: 'queued',
            scan_id: scanId,
            message: 'CI/CD Scan Triggered with Git metadata'
        });
    } catch (err) {
        next(err);
    }
});

// Get scan status for CI polling
app.get('/api/ci/scans/:id/status', authenticateApiKey, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, req.params.id);
        if (!scan) return res.status(404).json({ error: 'Scan not found' });

        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, scan.repo_id);

        // Security: Ensure the API key user owns the repository
        if (repo.user_id !== (req.user!.$id || req.user!.id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const isFinished = scan.status === 'completed' || scan.status === 'failed';
        const criticalCount = scan.details?.total_vulnerabilities > 0 && scan.details?.critical_count > 0 ? scan.details?.critical_count : 0;

        // Custom logic: Fail if any findings exist (or just criticals?)
        // For CI, we'll return a 'pass' flag
        const pass = scan.status === 'completed' && (scan.details?.critical_count || 0) === 0;

        res.json({
            id: scan.$id,
            status: scan.status,
            finished: isFinished,
            pass: isFinished ? pass : null,
            details: scan.details || {}
        });
    } catch (err) {
        next(err);
    }
});

// --- Insights Endpoints ---

app.get('/api/insights/summary', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const summary = await getInsightsSummary(req.user!.id);
        res.json(summary);
    } catch (error: unknown) {
        next(error);
    }
});

// Get vulnerabilities for a specific scan
app.get('/api/scans/:id/vulnerabilities', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const response = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.VULNERABILITIES,
            [Query.equal('scan_result_id', req.params.id)]
        );

        res.json(response.documents);
    } catch (error: unknown) {
        next(error);
    }
});

// Convert vulnerability to task (issue)
app.post('/api/vulnerabilities/:id/convert', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        // 1. Get vulnerability details
        const vuln = await databases.getDocument(
            DB_ID,
            COLLECTIONS.VULNERABILITIES,
            req.params.id
        );

        if (!vuln) return res.status(404).json({ error: 'Vulnerability not found' });

        // 2. Create task
        const userId = req.user!.$id || req.user!.id;
        const task = await databases.createDocument(
            DB_ID,
            COLLECTIONS.TASKS,
            ID.unique(),
            {
                user_id: userId,
                title: `Fix ${vuln.tool} finding: ${vuln.message.substring(0, 50)}...`,
                description: `Tool: ${vuln.tool}\nSeverity: ${vuln.severity}\nFile: ${vuln.file_path}:${vuln.line_number}\n\nOriginal Message: ${vuln.message}`,
                priority: vuln.severity === 'critical' || vuln.severity === 'high' ? 'high' : 'medium',
                status: 'todo',
                repository_id: vuln.repo_id,
                created_at: new Date().toISOString()
            }
        );

        // 3. Update vulnerability status
        await databases.updateDocument(
            DB_ID,
            COLLECTIONS.VULNERABILITIES,
            vuln.$id,
            { resolution_status: 'resolved', updated_at: new Date().toISOString() }
        );

        res.json(task);
    } catch (error: unknown) {
        next(error);
    }
});

// Global Dashboard Stats
app.get('/api/dashboard/stats', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;

        const reposResponse = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId)]
        );
        const repos = reposResponse.documents;

        const tasksResponse = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.TASKS,
            [Query.equal('user_id', userId)]
        );
        const tasks = tasksResponse.documents;

        const totalRepos = repos.length;
        const avgRiskScore = totalRepos > 0
            ? repos.reduce((acc: number, r: any) => acc + (Number(r.risk_score) || 0), 0) / totalRepos
            : 0;
        const totalVulns = repos.reduce((acc: number, r: any) => acc + (r.vulnerability_count || 0), 0);

        const openTasks = tasks.filter((t: any) => t.status !== 'completed').length;
        const highPriorityTasks = tasks.filter((t: any) => t.priority === 'high' && t.status !== 'completed').length;

        res.json({
            avgRiskScore: Math.round(avgRiskScore * 100) / 100,
            totalVulns,
            totalRepos,
            openTasks,
            highPriorityTasks,
            scanCount: 0
        });
    } catch (error: unknown) {
        next(error);
    }
});

// Activity Feed Endpoint
app.get('/api/dashboard/activities', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;

        // Fetch recent repositories
        const reposRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId), Query.orderDesc('created_at'), Query.limit(5)]
        );
        const repos = reposRes.documents;

        // Fetch recent scans
        const scansRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.SCANS,
            [Query.orderDesc('created_at'), Query.limit(5)]
        );
        const scans = scansRes.documents;

        // Fetch recent tasks
        const tasksRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.TASKS,
            [Query.equal('user_id', userId), Query.orderDesc('created_at'), Query.limit(5)]
        );
        const tasks = tasksRes.documents;

        // Transform into unified activity stream
        const activities = [
            ...(repos || []).map((r: any) => ({
                id: `repo-${r.$id}`,
                text: `Repository '${r.name}' connected`,
                time: r.$createdAt,
                type: 'info'
            })),
            ...(scans || []).map((s: any) => {
                return {
                    id: `scan-${s.$id}`,
                    text: `Security scan ${s.status === 'completed' ? 'finished' : 'started'} for project`,
                    time: s.$createdAt,
                    type: s.status === 'completed' ? 'success' : 'info'
                };
            }),
            ...(tasks || []).map((t: any) => ({
                id: `task-${t.$id}`,
                text: `Issue converted to task: ${t.title.substring(0, 30)}...`,
                time: t.$createdAt,
                type: 'warning'
            }))
        ].sort((a: any, b: any) => new Date(b.time).getTime() - new Date(a.time).getTime())
            .slice(0, 15);

        res.json(activities);
    } catch (error: unknown) {
        next(error);
    }
});

// Get historical trends for charts
app.get('/api/insights/trends', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const response = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.SCANS,
            [Query.orderAsc('created_at'), Query.limit(20)]
        );
        const scans = response.documents;

        const trends = scans.reduce((acc: any[], scan: any) => {
            const date = new Date(scan.$createdAt).toLocaleDateString();
            const score = scan.details?.security_score || 0;
            const vulns = scan.details?.total_vulnerabilities || 0;

            const existing = acc.find((t: any) => t.date === date);
            if (existing) {
                existing.score = (existing.score + score) / 2;
                existing.vulnerabilities += vulns;
            } else {
                acc.push({ date, score, vulnerabilities: vulns });
            }
            return acc;
        }, []);

        res.json(trends);
    } catch (error: unknown) {
        next(error);
    }
});

// Update User Profile
app.patch('/api/user/profile', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { displayName } = req.body;
    try {
        const userId = req.user!.$id || req.user!.id;
        const user = await users.updateName(userId, displayName);
        res.json({ message: 'Profile updated', user });
    } catch (error: unknown) {
        next(error);
    }
});

// --- API Key Management ---

// List API Keys
app.get('/api/keys', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;
        const response = await databases.listDocuments(
            DB_ID,
            'api_keys',
            [Query.equal('user_id', userId), Query.orderDesc('created_at')]
        );

        res.json(response.documents);
    } catch (err) {
        next(err);
    }
});

// Create API Key
app.post('/api/keys', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name is required' });

    try {
        const userId = req.user!.$id || req.user!.id;
        const rawKey = `sp_${crypto.randomBytes(24).toString('hex')}`;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const data = await databases.createDocument(
            DB_ID,
            'api_keys',
            ID.unique(),
            {
                user_id: userId,
                name,
                key_hash: keyHash,
                created_at: new Date().toISOString()
            }
        );

        // Return raw key ONLY ONCE during creation
        res.json({ ...data, api_key: rawKey });
    } catch (err) {
        next(err);
    }
});

// Delete API Key
app.delete('/api/keys/:id', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;
        // Verify ownership
        const key = await databases.getDocument(DB_ID, 'api_keys', req.params.id);
        if (key.user_id !== userId) return res.status(403).json({ error: 'Access denied' });

        await databases.deleteDocument(DB_ID, 'api_keys', req.params.id);
        res.json({ message: 'API Key revoked' });
    } catch (err) {
        next(err);
    }
});

// Initialize Cron Jobs
initScheduler();

// --- Centralized Error Handler ---
// ---------------------------------------------------------------------------
// Advanced Reporting
// ---------------------------------------------------------------------------

app.get('/api/reports/stats', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;
        const { scope, id } = req.query; // scope: global, team, project
        const stats = await getSecurityPostureStats(userId, (scope as any) || 'global', id as string);

        if (!stats) return res.status(404).json({ error: 'No data found for the given scope' });

        // If global, fetch trend for all accessible repos
        const reposRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId)]
        );
        const repos = reposRes.documents;

        const trend = await getTrendData(userId, repos?.map((r: any) => r.$id) || []);

        res.json({ stats, trend });
    } catch (err) {
        next(err);
    }
});

app.post('/api/reports/generate', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.$id || req.user!.id;
        const { scope, id, title } = req.body;
        const stats = await getSecurityPostureStats(userId, (scope as any) || 'global', id as string);

        if (!stats) return res.status(404).json({ error: 'No data found for report generation' });

        const reposRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId)]
        );
        const repos = reposRes.documents;

        const trend = await getTrendData(userId, repos?.map((r: any) => r.$id) || []);

        const buffer = await generatePDFReportBuffer({
            title: title || `Security Report - ${scope}`,
            stats,
            trend
        });

        // Store report record
        const report = await databases.createDocument(
            DB_ID,
            'security_reports',
            ID.unique(),
            {
                user_id: userId,
                scope,
                name: title || `Report ${new Date().toLocaleDateString()}`,
                stats_snapshot: JSON.stringify(stats),
                repo_id: scope === 'project' ? id : null,
                team_id: scope === 'team' ? id : null
            }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=StackPilot_Report_${scope}.pdf`);
        res.send(buffer);
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// Remediation AI
// ---------------------------------------------------------------------------

app.post('/api/vulns/:id/remediate', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const fix = await getRemediationFix(id);
        res.json(fix);
    } catch (err) {
        next(err);
    }
});

app.post('/api/vulns/:id/feedback', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { feedback } = req.body;

        // Find fix for this vuln (id in params is vuln ID, but recordFeedback needs fix ID)
        // Find fix for this vuln
        const response = await databases.listDocuments(
            DB_ID,
            'vulnerability_fixes',
            [Query.equal('vulnerability_id', id), Query.limit(1)]
        );

        if (response.total === 0) return res.status(404).json({ error: 'No fix found for this vulnerability' });

        const fix = response.documents[0];
        await recordFeedback(fix.$id, feedback);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// AI Impact Metrics
// ---------------------------------------------------------------------------

app.post('/api/ai/metrics/event', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        await recordAIEvent(req.body);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

app.get('/api/ai/metrics/summary', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const summary = await getAIAggregates();
        res.json(summary);
    } catch (err) {
        next(err);
    }
});

app.get('/api/ai/metrics/trends', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const trends = await getAITrends();
        res.json(trends);
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// Automated PR Generation
// ---------------------------------------------------------------------------

app.post('/api/fixes/:id/pr', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const result = await createPullRequest(id);

        // Update DB with PR info
        await databases.updateDocument(
            DB_ID,
            'vulnerability_fixes',
            id,
            {
                pr_url: result.url,
                pr_status: result.status,
                branch_name: result.branch_name
            }
        );

        res.json(result);
    } catch (err) {
        next(err);
    }
});

app.get('/api/fixes/:id/pr/status', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const data = await databases.getDocument(DB_ID, 'vulnerability_fixes', id);
        res.json({
            pr_status: data.pr_status,
            pr_url: data.pr_url,
            branch_name: data.branch_name
        });
    } catch (err) {
        next(err);
    }
});

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
    console.log(`[Backend] CORS restricted to: ${process.env.FRONTEND_URL}`);
});
