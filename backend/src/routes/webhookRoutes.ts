import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { logger, errorContext } from '../services/logger';
import { webhookIngestService } from '../services/webhookIngestService';
import { secretMatches } from '../utils/constantTimeCompare';
import {
  githubAppInstallSchema,
  githubWebhookSchema,
  gitlabWebhookSchema,
  testReportSchema
} from '../types/webhook.types';

const router = Router();

// Helper to validate GitHub Webhook signature
const validateGitHubSignature = (req: Request & { rawBody?: Buffer }): { isValid: boolean; error?: string } => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!secret) return { isValid: false, error: 'GITHUB_WEBHOOK_SECRET not configured' };
    if (!signature) return { isValid: false, error: 'Missing signature' };

    // GitHub signs the exact request bytes. Verify against the captured raw body
    // (set by express.json's verify hook) — re-serializing req.body via
    // JSON.stringify produces different bytes and fails every legitimate delivery.
    if (!req.rawBody) return { isValid: false, error: 'Raw body unavailable' };

    const hmac = crypto.createHmac('sha256', secret);
    const digest = Buffer.from('sha256=' + hmac.update(req.rawBody).digest('hex'), 'utf8');
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
        if (error === 'GITHUB_WEBHOOK_SECRET not configured') logger.error(`[Webhook] ${error}`);
        return res.status(error === 'Missing signature' || error === 'Invalid signature' ? 401 : 500).json({ error });
    }

    const parsed = githubWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid GitHub webhook payload' });
    }
    const payload = parsed.data;
    const event = req.headers['x-github-event'];

    if (event === 'workflow_run') {
        try {
            const result = await webhookIngestService.processGithubWorkflowRun(payload);
            switch (result.status) {
                case 'no_payload': return res.json({ message: 'Missing workflow_run payload' });
                case 'missing_repo_url': return res.status(400).json({ error: 'Missing repository URL in payload' });
                case 'no_match': return res.json({ message: 'No matching repository found' });
                case 'ok': return res.json({ message: result.message });
            }
        } catch (err) {
            logger.error('[Webhook] Error processing workflow_run:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    if (event !== 'push' && event !== 'pull_request') {
        return res.json({ message: `Event ${event} ignored` });
    }

    try {
        const result = await webhookIngestService.processGithubPushOrPullRequest(event, payload);
        switch (result.status) {
            case 'missing_repo_url': return res.status(400).json({ error: 'Missing repository URL in payload' });
            case 'no_match': return res.json({ message: 'No matching repository found' });
            case 'ok': return res.json({ message: `Triggered ${result.runs.length} pipeline run(s)`, runs: result.runs });
        }
    } catch (err) {
        logger.error('[Webhook] Error processing webhook:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Standard GitLab Webhook for automated pipeline runs
 */
router.post('/gitlab', async (req: Request, res: Response) => {
    const expectedToken = process.env.GITLAB_WEBHOOK_SECRET;

    // Fails closed: an unconfigured secret must never leave this endpoint open.
    // The `!expectedToken` check stays here rather than inside secretMatches so
    // the fail-closed decision is visible at the guard, not delegated to a helper.
    if (!expectedToken || !secretMatches(req.headers['x-gitlab-token'], expectedToken)) {
        return res.status(401).json({ error: 'Invalid GitLab webhook token' });
    }

    const event = req.headers['x-gitlab-event'] as string;
    if (event !== 'Push Hook' && event !== 'Merge Request Hook') {
        return res.json({ message: `Event ${event} ignored` });
    }

    const parsed = gitlabWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid GitLab webhook payload' });
    }

    try {
        const result = await webhookIngestService.processGitlabEvent(event, parsed.data);
        switch (result.status) {
            case 'missing_repo_url': return res.status(400).json({ error: 'Missing repository URL in GitLab payload' });
            case 'no_match': return res.json({ message: 'No matching repository found' });
            case 'ok': return res.json({ message: `Triggered ${result.runs.length} pipeline run(s)`, runs: result.runs });
        }
    } catch (err) {
        logger.error('[GitLab Webhook Error]', { event: 'GITLAB_WEBHOOK_FAILED', gitlabEvent: event, ...errorContext(err) });
        res.status(500).json({ error: 'Internal server error' });
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

    const parsed = githubAppInstallSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid GitHub App installation payload' });
    }

    try {
        const result = await webhookIngestService.processGithubAppInstall(parsed.data);
        if (result.status === 'user_not_found') {
            return res.status(404).json({ error: 'User correlation failed' });
        }
        res.json({ message: 'Installation processed and repositories synchronized' });
    } catch (err) {
        logger.error('[Webhook] App installation error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * CI Test Report Webhook
 */
router.post('/tests/report', async (req: Request, res: Response) => {
    const expectedSecret = process.env.TESTS_REPORT_SECRET;
    // Fails closed: an unconfigured secret must never leave this endpoint open.
    if (!expectedSecret || !secretMatches(req.headers['x-tests-report-secret'], expectedSecret)) {
        return res.status(401).json({ error: 'Unauthorized test report source' });
    }

    const parsed = testReportSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Missing repo_url' });
    }

    try {
        const result = await webhookIngestService.processTestReport(parsed.data);
        if (result.status === 'no_match') {
            return res.json({ message: 'No matching repository found' });
        }
        res.json({ message: 'Test report recorded' });
    } catch (err) {
        logger.error('[Webhook] Error processing test report:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
