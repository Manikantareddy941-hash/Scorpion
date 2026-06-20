import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { databases, users, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { enqueueScan } from '../queues/scanQueue';
import { triggerPipelineRun } from '../services/pipelineService';

const router = Router();

// Helper to validate GitHub Webhook signature
const validateGitHubSignature = (req: Request): { isValid: boolean; error?: string } => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!secret) return { isValid: false, error: 'GITHUB_WEBHOOK_SECRET not configured' };
    if (!signature) return { isValid: false, error: 'Missing signature' };

    const hmac = crypto.createHmac('sha256', secret);
    const bodyStr = JSON.stringify(req.body);
    const digest = Buffer.from('sha256=' + hmac.update(bodyStr).digest('hex'), 'utf8');
    const checksum = Buffer.from(signature, 'utf8');

    if (checksum.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
        return { isValid: false, error: 'Invalid signature' };
    }

    return { isValid: true };
};

/**
 * Standard GitHub Webhook for automated scanning (Manual Webhooks)
 */
router.post('/github', async (req: Request, res: Response) => {
    const { isValid, error } = validateGitHubSignature(req);
    if (!isValid) {
        if (error === 'GITHUB_WEBHOOK_SECRET not configured') console.error(`[Webhook] ${error}`);
        return res.status(error === 'Missing signature' || error === 'Invalid signature' ? 401 : 500).json({ error });
    }

    const event = req.headers['x-github-event'];
    
    if (event === 'workflow_run') {
        const workflowRun = req.body.workflow_run;
        if (!workflowRun) return res.json({ message: 'Missing workflow_run payload' });

        const repoUrl = req.body.repository?.html_url;
        if (!repoUrl) return res.status(400).json({ error: 'Missing repository URL in payload' });

        try {
            const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
                Query.equal('url', repoUrl)
            ]);

            if (repos.total === 0) {
                return res.json({ message: 'No matching repository found' });
            }

            const status = workflowRun.conclusion || workflowRun.status || 'in_progress';

            for (const repo of repos.documents) {
                try {
                    await databases.createDocument(DB_ID, COLLECTIONS.BUILDS, ID.unique(), {
                        repo_id: repo.$id,
                        repo_name: req.body.repository?.name || 'Unknown',
                        workflow_name: workflowRun.name || 'CI',
                        status: status,
                        run_number: String(workflowRun.run_number || '1'),
                        run_url: workflowRun.html_url || '',
                        timestamp: workflowRun.updated_at || workflowRun.created_at || new Date().toISOString()
                    });
                } catch (err) {
                    console.error('[Webhook] Failed to log build:', err);
                }

                if (status === 'success') {
                    enqueueScan(repo.$id, {}).catch(err => {
                        console.error(`[Webhook] Failed to enqueue scan for ${repo.$id}:`, err);
                    });
                }
            }

            return res.json({ message: `Logged workflow_run and handled triggers for ${repos.total} repository(ies)` });
        } catch (err) {
            console.error('[Webhook] Error processing workflow_run:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    if (event !== 'push' && event !== 'pull_request') {
        return res.json({ message: `Event ${event} ignored` });
    }

    const repoUrl = req.body.repository?.html_url;
    if (!repoUrl) {
        return res.status(400).json({ error: 'Missing repository URL in payload' });
    }

    try {
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('url', repoUrl)
        ]);

        if (repos.total === 0) {
            return res.json({ message: 'No matching repository found' });
        }

        const branch = event === 'push' 
            ? (req.body.ref?.replace('refs/heads/', '') || 'main')
            : (req.body.pull_request?.head?.ref || 'main');

        const commitHash = event === 'push'
            ? (req.body.head_commit?.id || 'HEAD')
            : (req.body.pull_request?.head?.sha || 'HEAD');

        const commitMessage = event === 'push'
            ? (req.body.head_commit?.message || 'Push event trigger')
            : (req.body.pull_request?.title || 'Pull request event trigger');

        const author = event === 'push'
            ? (req.body.head_commit?.author?.name || req.body.head_commit?.author?.username || 'Unknown')
            : (req.body.pull_request?.user?.login || 'Unknown');

        // Log the commits first (reusing existing schema)
        if (event === 'push') {
            const commits = req.body.commits || [];
            const sensitivePatterns = ['.env', 'password', 'secret', 'key.pem', 'credentials', 'config.json', 'token'];
            for (const repo of repos.documents) {
                for (const commit of commits) {
                    const filesChanged = [
                        ...(commit.added || []),
                        ...(commit.modified || []),
                        ...(commit.removed || [])
                    ];
                    const isSensitive = filesChanged.some(file => 
                        sensitivePatterns.some(pattern => file.toLowerCase().includes(pattern))
                    );
                    try {
                        await databases.createDocument(DB_ID, COLLECTIONS.COMMITS, ID.unique(), {
                            repo_id: repo.$id,
                            commit_hash: commit.id || String(Date.now()),
                            author: commit.author?.name || commit.author?.username || 'Unknown',
                            message: commit.message || '',
                            url: commit.url || '',
                            timestamp: commit.timestamp || new Date().toISOString(),
                            files_changed: filesChanged.map(String),
                            is_sensitive: isSensitive
                        });
                    } catch (err) {
                        console.error('[Webhook] Failed to log commit:', err);
                    }
                }
            }
        }

        const triggeredRuns: string[] = [];
        for (const repo of repos.documents) {
            const runId = await triggerPipelineRun(
                repo.$id,
                branch,
                commitHash,
                commitMessage,
                author
            );
            triggeredRuns.push(runId);
        }

        res.json({ 
            message: `Triggered ${triggeredRuns.length} pipeline run(s)`, 
            runs: triggeredRuns 
        });
    } catch (err: any) {
        console.error('[Webhook] Error processing webhook:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Standard GitLab Webhook for automated pipeline runs
 */
router.post('/gitlab', async (req: Request, res: Response) => {
    const gitlabToken = req.headers['x-gitlab-token'] as string;
    const expectedToken = process.env.GITLAB_WEBHOOK_SECRET;

    if (expectedToken && gitlabToken !== expectedToken) {
        return res.status(401).json({ error: 'Invalid GitLab webhook token' });
    }

    const event = req.headers['x-gitlab-event'] as string;
    if (event !== 'Push Hook' && event !== 'Merge Request Hook') {
        return res.json({ message: `Event ${event} ignored` });
    }

    const repoUrl = req.body.project?.web_url || req.body.repository?.homepage;
    if (!repoUrl) {
        return res.status(400).json({ error: 'Missing repository URL in GitLab payload' });
    }

    try {
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('url', repoUrl)
        ]);

        if (repos.total === 0) {
            return res.json({ message: 'No matching repository found' });
        }

        const branch = event === 'Push Hook'
            ? (req.body.ref?.replace('refs/heads/', '') || 'main')
            : (req.body.object_attributes?.source_branch || 'main');

        const commitHash = event === 'Push Hook'
            ? (req.body.checkout_sha || 'HEAD')
            : (req.body.object_attributes?.last_commit?.id || 'HEAD');

        const commitMessage = event === 'Push Hook'
            ? (req.body.commits?.[0]?.message || 'GitLab Push trigger')
            : (req.body.object_attributes?.title || 'GitLab Merge Request trigger');

        const author = event === 'Push Hook'
            ? (req.body.user_name || req.body.commits?.[0]?.author?.name || 'Unknown')
            : (req.body.object_attributes?.last_commit?.author?.name || 'Unknown');

        const triggeredRuns: string[] = [];
        for (const repo of repos.documents) {
            const runId = await triggerPipelineRun(
                repo.$id,
                branch,
                commitHash,
                commitMessage,
                author
            );
            triggeredRuns.push(runId);
        }

        res.json({ 
            message: `Triggered ${triggeredRuns.length} pipeline run(s)`, 
            runs: triggeredRuns 
        });
    } catch (err: any) {
        console.error('[GitLab Webhook Error]', err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

/**
 * GitHub App Installation Webhook
 */
router.post('/github/app-install', async (req: Request, res: Response) => {
    const { isValid, error } = validateGitHubSignature(req);
    if (!isValid) {
        return res.status(401).json({ error });
    }

    const event = req.headers['x-github-event'];
    if (event !== 'installation' && event !== 'installation_repositories') {
        return res.json({ message: `Event ${event} ignored` });
    }

    const { installation, repositories, sender } = req.body;
    const githubUserId = String(sender.id);
    const installationId = String(installation.id);

    try {
        // Find SCORPION user by github_user_id in preferences
        // Since Appwrite doesn't support direct preference querying, we iterate over current users
        const allUsers = await users.list();
        const targetUser = allUsers.users.find((u: any) => u.prefs?.github_user_id === githubUserId);

        if (!targetUser) {
            console.warn(`[Webhook] No SCORPION user found for GitHub ID: ${githubUserId}`);
            return res.status(404).json({ error: 'User correlation failed' });
        }

        // Update user prefs with installation_id
        await users.updatePrefs(targetUser.$id, {
            ...targetUser.prefs,
            github_installation_id: installationId
        });

        // Automatically register repositories
        if (repositories && repositories.length > 0) {
            for (const repo of repositories) {
                const url = repo.html_url || `https://github.com/${repo.full_name}`;
                const name = repo.name || repo.full_name.split('/').pop();
                
                const existingRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
                    Query.equal('user_id', targetUser.$id),
                    Query.equal('url', url),
                    Query.limit(1)
                ]);

                if (existingRepos.total === 0) {
                    await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), {
                        user_id: targetUser.$id,
                        url,
                        name,
                        visibility: 'public',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }
            }
        }

        res.json({ message: 'Installation processed and repositories synchronized' });
    } catch (err: any) {
        console.error('[Webhook] App installation error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * CI Test Report Webhook
 */
router.post('/tests/report', async (req: Request, res: Response) => {
    const secret = req.headers['x-tests-report-secret'];
    if (!process.env.TESTS_REPORT_SECRET || secret !== process.env.TESTS_REPORT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized test report source' });
    }

    const { repo_url, build_id, total_tests, passed_tests, failed_tests, skipped_tests, coverage, status } = req.body;

    if (!repo_url) return res.status(400).json({ error: 'Missing repo_url' });

    try {
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('url', repo_url)
        ]);

        if (repos.total === 0) return res.json({ message: 'No matching repository found' });
        
        for (const repo of repos.documents) {
            const hasFailed = Number(failed_tests || 0) > 0 || status === 'failed';
            
            await databases.createDocument(DB_ID, COLLECTIONS.TEST_RUNS, ID.unique(), {
                repo_id: repo.$id,
                repo_name: repo.name,
                build_id: String(build_id || Date.now()),
                total_tests: Number(total_tests || 0),
                passed_tests: Number(passed_tests || 0),
                failed_tests: Number(failed_tests || 0),
                skipped_tests: Number(skipped_tests || 0),
                coverage: Number(coverage || 0),
                status: hasFailed ? 'failed' : 'passed',
                timestamp: new Date().toISOString()
            });

            if (!hasFailed) {
               enqueueScan(repo.$id, {}).catch(e => console.error(e));
            } else {
               console.warn(`[Test Webhook] Skipping scan for ${repo.$id} due to failed tests`);
            }
        }

        res.json({ message: 'Test report recorded' });
    } catch (err) {
        console.error('[Webhook] Error processing test report:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
