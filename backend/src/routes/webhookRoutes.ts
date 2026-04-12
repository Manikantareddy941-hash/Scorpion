import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { databases, users, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { triggerScan } from '../services/scanService';

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
    if (event !== 'push') {
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

        for (const repo of repos.documents) {
            triggerScan(repo.$id, 'public').catch(err => {
                console.error(`[Webhook] Failed to trigger scan for ${repo.$id}:`, err);
            });
        }

        res.json({ message: `Scan triggered for ${repos.total} repository(ies)` });
    } catch (err: any) {
        console.error('[Webhook] Error processing webhook:', err);
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

export default router;
