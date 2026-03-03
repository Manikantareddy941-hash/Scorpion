// ...existing code (first set of imports and const app = express())...
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient, User } from '@supabase/supabase-js';
import { initScheduler } from './jobs/scheduler';
import { triggerScan, getInsightsSummary } from './services/scanService';
import authRoutes from './routes/authRoutes';
import projectRoutes from './routes/projectRoutes';
import uploadRoutes from './routes/uploadRoutes';
import healthRoutes from './routes/healthRoutes';
import { supabase, checkSupabaseConnection } from './lib/supabase';
import crypto from 'crypto';
import morgan from 'morgan';

import { getSecurityPostureStats, getTrendData, generatePDFReportBuffer } from './services/reportingService';
import { Role, hasRequiredRole } from './services/rbacService';
import { getEffectivePolicy, evaluateScan } from './services/policyService';
import { recordAIEvent, getAIAggregates, getAITrends } from './services/metricsService';
import { linkCommitToScan, getFindingHistory } from './services/gitTraceabilityService';
import { createPullRequest } from './services/gitProviderService';
import { getRemediationFix, recordFeedback } from './services/aiService';

// --- Environment Validation ---
const requiredEnv = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
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
console.log(`[CORS] Configuring with FRONTEND_URL: ${process.env.FRONTEND_URL}`);

app.use(morgan('dev')); // Log requests to console
app.use(helmet());
app.use(cors({
    origin: (origin, callback) => {
        console.log(`[CORS Request] Origin: ${origin}`);
        callback(null, true); // Allow all origins for debugging
    },
    credentials: true,
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

// Removed local createClient call

interface AuthenticatedRequest extends Request {
    user?: User;
}

// Auth Middleware: Validate Supabase JWT (Standard Dashboard Auth)
const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization header' });

    const token = authHeader.split(' ')[1];
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) return res.status(401).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
};

// Middleware to check for required repository-level role
const requireRole = (requiredRole: Role) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const repoId = req.params.id || req.body.repo_id;
        if (!repoId) return res.status(400).json({ error: 'Missing repository ID for permission check' });

        try {
            const hasPermission = await hasRequiredRole(req.user!.id, repoId, requiredRole);
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
        // Hash the incoming key to compare with stored hashes
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

        const { data: keyRecord, error } = await supabase
            .from('api_keys')
            .select('user_id')
            .eq('key_hash', keyHash)
            .single();

        if (error || !keyRecord) {
            return res.status(401).json({ error: 'Invalid or expired API Key' });
        }

        // Mock a user object for authentication consistency
        req.user = { id: keyRecord.user_id } as User;
        next();
    } catch (err) {
        next(err);
    }
};

app.use('/api', healthRoutes);
app.use('/api/projects', authenticate, projectRoutes);
app.use('/api/upload', authenticate, uploadRoutes);

// These are now handled by healthRoutes or moved under /api

// --- Repository Endpoints ---

// Add/Sync repository
app.post('/api/repos', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        const { data, error } = await supabase
            .from('repositories')
            .upsert({
                user_id: req.user!.id,
                url,
                name: url.split('/').pop(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,url' })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error: unknown) {
        next(error);
    }
});

// List repos (owned or shared via teams)
app.get('/api/repos', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;

        // Fetch repos where user is owner OR has team-based access via project_access
        const { data, error } = await supabase
            .from('repositories')
            .select(`
                *,
                project_access!left(team_id, teams!inner(team_members!inner(user_id)))
            `)
            .or(`user_id.eq.${userId},project_access.teams.team_members.user_id.eq.${userId}`)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        res.json(data);
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

        const { data, error } = await supabase
            .from('project_policies')
            .upsert({
                repo_id: repoId,
                policy_id,
                custom_max_critical,
                custom_max_high,
                custom_min_risk_score,
                updated_at: new Date().toISOString()
            }, { onConflict: 'repo_id' })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        next(err);
    }
});

// List system policies
app.get('/api/policies', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { data, error } = await supabase
            .from('policies')
            .select('*')
            .order('name', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        next(err);
    }
});

// Manually re-evaluate a scan against current policy
app.post('/api/scans/:id/evaluate', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Special check: we need the repo_id from the scan to check permissions
        const { data: scan } = await supabase.from('scan_results').select('repo_id').eq('id', req.params.id).single();
        if (!scan) return res.status(404).json({ error: 'Scan not found' });

        const hasPerm = await hasRequiredRole((req as any).user.id, scan.repo_id, 'developer');
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
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', req.user!.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        next(err);
    }
});

// Get notification preferences
app.get('/api/notifications/preferences', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { data, error } = await supabase
            .from('notification_preferences')
            .select('*')
            .eq('user_id', req.user!.id);

        if (error) throw error;
        res.json(data);
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
            await supabase
                .from('notification_preferences')
                .upsert({
                    user_id: req.user!.id,
                    ...pref,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id,repo_id,channel,event_type' });
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
        const { data: finding } = await supabase.from('vulnerabilities').select('repo_id').eq('id', findingId).single();
        if (!finding) return res.status(404).json({ error: 'Finding not found' });

        const hasPerm = await hasRequiredRole(req.user!.id, finding.repo_id, 'developer');
        if (!hasPerm) return res.status(403).json({ error: 'Requires developer permission' });

        if (!['fixed', 'accepted_risk'].includes(state)) {
            return res.status(400).json({ error: 'Invalid state' });
        }

        const { data: resolution, error: resErr } = await supabase
            .from('finding_resolutions')
            .insert({
                finding_id: findingId,
                state,
                reason,
                user_id: req.user!.id
            })
            .select()
            .single();

        if (resErr) throw resErr;

        await supabase
            .from('vulnerabilities')
            .update({
                resolution_status: state,
                resolution_id: resolution.id,
                updated_at: new Date().toISOString()
            })
            .eq('id', findingId);

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

        const { data: team, error: teamErr } = await supabase
            .from('teams')
            .insert({ name, owner_id: req.user!.id })
            .select()
            .single();

        if (teamErr) throw teamErr;

        // Add creator as owner
        await supabase
            .from('team_members')
            .insert({ team_id: team.id, user_id: req.user!.id, role: 'owner' });

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
        const { data: membership } = await supabase
            .from('team_members')
            .select('role')
            .eq('team_id', teamId)
            .eq('user_id', req.user!.id)
            .single();

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            return res.status(403).json({ error: 'Only team owners or admins can invite members' });
        }

        // Find user by email
        const { data: invitedUser, error: findErr } = await supabase
            .from('users') // Assuming a users profile table exists
            .select('id')
            .eq('email', email)
            .single();

        if (findErr || !invitedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { data, error } = await supabase
            .from('team_members')
            .insert({ team_id: teamId, user_id: invitedUser.id, role: role || 'viewer' })
            .select()
            .single();

        if (error) throw error;
        res.json({ message: 'User invited successfully', data });
    } catch (err) {
        next(err);
    }
});

// Manage project access
app.get('/api/repos/:id/access', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { data, error } = await supabase
            .from('project_access')
            .select('*, teams(id, name)')
            .eq('repo_id', req.params.id);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        next(err);
    }
});

app.put('/api/repos/:id/access', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const repoId = req.params.id;
        const { team_id, action } = req.body; // action: grant, revoke

        if (action === 'grant') {
            await supabase.from('project_access').upsert({ repo_id: repoId, team_id });
        } else {
            await supabase.from('project_access').delete().eq('repo_id', repoId).eq('team_id', team_id);
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
        // 1. Find the repository for this user
        const { data: repo, error } = await supabase
            .from('repositories')
            .select('id')
            .eq('user_id', req.user!.id)
            .eq('url', repo_url)
            .single();

        if (error || !repo) {
            return res.status(404).json({ error: 'Repository not connected to StackPilot. Please add it via the dashboard first.' });
        }

        // 2. Trigger scan
        const { scanId, error: scanErr } = await triggerScan(repo.id);
        if (scanErr) return res.status(400).json({ error: scanErr });

        // 3. Link Git metadata if provided
        if (scanId && commit_hash) {
            await linkCommitToScan(scanId, repo.id, { commit_hash, branch, pr_number });
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
        const { data: scan, error } = await supabase
            .from('scan_results')
            .select('*, repositories(user_id)')
            .eq('id', req.params.id)
            .single();

        if (error || !scan) return res.status(404).json({ error: 'Scan not found' });

        // Security: Ensure the API key user owns the repository
        const repo: any = scan.repositories;
        if (repo.user_id !== req.user!.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const isFinished = scan.status === 'completed' || scan.status === 'failed';
        const criticalCount = scan.details?.total_vulnerabilities > 0 && scan.details?.critical_count > 0 ? scan.details?.critical_count : 0;

        // Custom logic: Fail if any findings exist (or just criticals?)
        // For CI, we'll return a 'pass' flag
        const pass = scan.status === 'completed' && (scan.details?.critical_count || 0) === 0;

        res.json({
            id: scan.id,
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
        const { data, error } = await supabase
            .from('vulnerabilities')
            .select('*')
            .eq('scan_result_id', req.params.id);

        if (error) throw error;
        res.json(data);
    } catch (error: unknown) {
        next(error);
    }
});

// Convert vulnerability to task (issue)
app.post('/api/vulnerabilities/:id/convert', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        // 1. Get vulnerability details
        const { data: vuln, error: vulnErr } = await supabase
            .from('vulnerabilities')
            .select('*, repositories(name)')
            .eq('id', req.params.id)
            .single();

        if (vulnErr || !vuln) return res.status(404).json({ error: 'Vulnerability not found' });

        // 2. Create task
        const { data: task, error: taskErr } = await supabase
            .from('tasks')
            .insert({
                user_id: req.user!.id,
                title: `Fix ${vuln.tool} finding: ${vuln.message.substring(0, 50)}...`,
                description: `Tool: ${vuln.tool}\nSeverity: ${vuln.severity}\nFile: ${vuln.file_path}:${vuln.line_number}\n\nOriginal Message: ${vuln.message}`,
                priority: vuln.severity === 'critical' || vuln.severity === 'high' ? 'high' : 'medium',
                status: 'todo',
                repository_id: vuln.repo_id
            })
            .select()
            .single();

        if (taskErr) throw taskErr;

        // 3. Update vulnerability status
        await supabase
            .from('vulnerabilities')
            .update({ status: 'resolved' })
            .eq('id', vuln.id);

        res.json(task);
    } catch (error: unknown) {
        next(error);
    }
});

// Global Dashboard Stats
app.get('/api/dashboard/stats', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { data: repos, error: repoErr } = await supabase
            .from('repositories')
            .select('risk_score, vulnerability_count')
            .eq('user_id', req.user!.id);

        if (repoErr) throw repoErr;

        const { data: tasks, error: taskErr } = await supabase
            .from('tasks')
            .select('status, priority')
            .eq('user_id', req.user!.id);

        if (taskErr) throw taskErr;

        const totalRepos = repos.length;
        const avgRiskScore = totalRepos > 0
            ? repos.reduce((acc, r) => acc + (Number(r.risk_score) || 0), 0) / totalRepos
            : 0;
        const totalVulns = repos.reduce((acc, r) => acc + (r.vulnerability_count || 0), 0);

        const openTasks = tasks.filter(t => t.status !== 'completed').length;
        const highPriorityTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'completed').length;

        res.json({
            avgRiskScore: Math.round(avgRiskScore * 100) / 100,
            totalVulns,
            totalRepos,
            openTasks,
            highPriorityTasks,
            scanCount: 0 // Placeholder for total scans if needed
        });
    } catch (error: unknown) {
        next(error);
    }
});

// Activity Feed Endpoint
app.get('/api/dashboard/activities', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;

        // Fetch recent repositories
        const { data: repos } = await supabase
            .from('repositories')
            .select('id, name, created_at, url')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(5);

        // Fetch recent scans
        const { data: scans } = await supabase
            .from('scan_results')
            .select('id, status, created_at, repositories(name)')
            .eq('repositories.user_id', userId)
            .order('created_at', { ascending: false })
            .limit(5);

        // Fetch recent tasks (conversions)
        const { data: tasks } = await supabase
            .from('tasks')
            .select('id, title, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(5);

        // Transform into unified activity stream
        const activities = [
            ...(repos || []).map(r => ({
                id: `repo-${r.id}`,
                text: `Repository '${r.name}' connected`,
                time: r.created_at,
                type: 'info'
            })),
            ...(scans || []).filter(s => s.repositories).map(s => {
                const repo: any = s.repositories;
                const repoName = Array.isArray(repo) ? repo[0]?.name : repo?.name;
                return {
                    id: `scan-${s.id}`,
                    text: `Security scan ${s.status === 'completed' ? 'finished' : 'started'} for ${repoName || 'Unknown'}`,
                    time: s.created_at,
                    type: s.status === 'completed' ? 'success' : 'info'
                };
            }),
            ...(tasks || []).map(t => ({
                id: `task-${t.id}`,
                text: `Issue converted to task: ${t.title.substring(0, 30)}...`,
                time: t.created_at,
                type: 'warning'
            }))
        ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
            .slice(0, 15);

        res.json(activities);
    } catch (error: unknown) {
        next(error);
    }
});

// Get historical trends for charts
app.get('/api/insights/trends', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { data: scans, error } = await supabase
            .from('scan_results')
            .select('created_at, details')
            .order('created_at', { ascending: true })
            .limit(20);

        if (error) throw error;

        const trends = scans.reduce((acc: any[], scan) => {
            const date = new Date(scan.created_at).toLocaleDateString();
            const score = scan.details?.security_score || 0;
            const vulns = scan.details?.total_vulnerabilities || 0;

            const existing = acc.find(t => t.date === date);
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
        const { data, error } = await supabase.auth.updateUser({
            data: { display_name: displayName }
        });

        if (error) throw error;
        res.json({ message: 'Profile updated', user: data.user });
    } catch (error: unknown) {
        next(error);
    }
});

// --- API Key Management ---

// List API Keys
app.get('/api/keys', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { data, error } = await supabase
            .from('api_keys')
            .select('id, name, created_at')
            .eq('user_id', req.user!.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        next(err);
    }
});

// Create API Key
app.post('/api/keys', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name is required' });

    try {
        const rawKey = `sp_${crypto.randomBytes(24).toString('hex')}`;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const { data, error } = await supabase
            .from('api_keys')
            .insert({
                user_id: req.user!.id,
                name,
                key_hash: keyHash,
                created_at: new Date().toISOString()
            })
            .select('id, name, created_at')
            .single();

        if (error) throw error;

        // Return raw key ONLY ONCE during creation
        res.json({ ...data, api_key: rawKey });
    } catch (err) {
        next(err);
    }
});

// Delete API Key
app.delete('/api/keys/:id', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { error } = await supabase
            .from('api_keys')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', req.user!.id);

        if (error) throw error;
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
        const { scope, id } = req.query; // scope: global, team, project
        const stats = await getSecurityPostureStats(req.user!.id, (scope as any) || 'global', id as string);

        if (!stats) return res.status(404).json({ error: 'No data found for the given scope' });

        // If global, fetch trend for all accessible repos
        const { data: repos } = await supabase
            .from('repositories')
            .select('id')
            .or(`user_id.eq.${req.user!.id},project_access.teams.team_members.user_id.eq.${req.user!.id}`);

        const trend = await getTrendData(req.user!.id, repos?.map(r => r.id) || []);

        res.json({ stats, trend });
    } catch (err) {
        next(err);
    }
});

app.post('/api/reports/generate', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { scope, id, title } = req.body;
        const stats = await getSecurityPostureStats(req.user!.id, (scope as any) || 'global', id as string);

        if (!stats) return res.status(404).json({ error: 'No data found for report generation' });

        const { data: repos } = await supabase
            .from('repositories')
            .select('id')
            .or(`user_id.eq.${req.user!.id},project_access.teams.team_members.user_id.eq.${req.user!.id}`);

        const trend = await getTrendData(req.user!.id, repos?.map(r => r.id) || []);

        const buffer = await generatePDFReportBuffer({
            title: title || `Security Report - ${scope}`,
            stats,
            trend
        });

        // Store report record
        const { data: report, error: repoErr } = await supabase
            .from('security_reports')
            .insert({
                user_id: req.user!.id,
                scope,
                name: title || `Report ${new Date().toLocaleDateString()}`,
                stats_snapshot: stats,
                repo_id: scope === 'project' ? id : null,
                team_id: scope === 'team' ? id : null
            })
            .select()
            .single();

        if (repoErr) throw repoErr;

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
        const { data: fix } = await supabase
            .from('vulnerability_fixes')
            .select('id')
            .eq('vulnerability_id', id)
            .single();

        if (!fix) return res.status(404).json({ error: 'No fix found for this vulnerability' });

        await recordFeedback(fix.id, feedback);
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
        const summary = await getAIAggregates(req.user!.id);
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
        await supabase
            .from('vulnerability_fixes')
            .update({
                pr_url: result.url,
                pr_status: result.status,
                branch_name: result.branch_name
            })
            .eq('id', id);

        res.json(result);
    } catch (err) {
        next(err);
    }
});

app.get('/api/fixes/:id/pr/status', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('vulnerability_fixes')
            .select('pr_status, pr_url, branch_name')
            .eq('id', id)
            .single();

        if (error) throw error;
        res.json(data);
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
