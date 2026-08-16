import express, { Request } from 'express';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { AlertService } from '../services/alertService';
import { canAccessResource } from '../services/tenancyService';
import { assertSafeWebhookUrl } from '../utils/ssrfGuard';
import { requireEmailVerification } from '../middleware/requireEmailVerification';
import { Models } from 'node-appwrite';
import { logger, errorContext, errorMessage } from '../services/logger';

interface AuthenticatedRequest extends Request<Record<string, string>> {
    user?: Models.User<Models.Preferences>;
}

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Helper to authenticate request (assuming similar structure to other routes)
// But since the user wants us to call this from frontend or engine, let's keep it simple.
// We should probably check the user token, but we'll use a basic approach.

router.post('/test', async (req, res) => {
    try {
        // The Alerts page has always sent `url`, while this handler only read
        // `webhookUrl` — so the Test button 400d on every click. Accept both
        // rather than breaking any caller that does send webhookUrl.
        const { type } = req.body;
        const webhookUrl = req.body.webhookUrl ?? req.body.url;

        if (!webhookUrl) {
            return res.status(400).json({ error: 'Missing webhookUrl' });
        }
        try {
            await assertSafeWebhookUrl(webhookUrl);
        } catch (err: unknown) {
            return res.status(400).json({ error: errorMessage(err) });
        }

        const mockFinding = {
            vulnerability_id: 'CVE-2026-TEST',
            severity: 'critical',
            description: 'This is a test telemetry transmission to verify the SCORPION notification bridge.',
            package_name: 'scorpion-core',
            fixed_version: 'v2.0.0'
        };

        if (type === 'slack') {
            await AlertService.sendSlackAlert(webhookUrl, [mockFinding], 'test-scan-id', 'Test Repository', FRONTEND_URL);
        } else {
            await AlertService.sendDiscordAlert(webhookUrl, [mockFinding], 'test-scan-id', 'Test Repository', FRONTEND_URL);
        }

        res.status(200).json({ success: true, message: 'Test alert sent' });
    } catch (error: unknown) {
        // Extra reason to sanitise here: a failed Slack/Discord POST is an axios
        // rejection whose message can carry the webhook URL, and the token is in
        // that URL's path. errorContext already withholds transport fields, so
        // the log is safe; the raw message was not. No webhookUrl correlator.
        logger.error('[Alerts] test alert failed', {
            event: 'ALERT_TEST_SEND_FAILED', channel: req.body?.type, ...errorContext(error),
        });
        res.status(500).json({ error: 'Failed to send test alert' });
    }
});

router.post('/notify', async (req: AuthenticatedRequest, res) => {
    try {
        const { findingId, webhookUrl, type, repoName } = req.body;

        try {
            await assertSafeWebhookUrl(webhookUrl);
        } catch (err: unknown) {
            return res.status(400).json({ error: errorMessage(err) });
        }

        const findingDoc = await databases.getDocument(DB_ID, COLLECTIONS.FINDINGS, findingId);

        const repo = findingDoc.repo_id ? await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, findingDoc.repo_id).catch(() => null) : null;
        if (!repo || !(await canAccessResource(repo, req.user?.$id))) {
            return res.status(403).json({ error: 'You do not have access to this finding' });
        }

        const finding = {
            vulnerability_id: findingDoc.vulnerability_id,
            rule_id: findingDoc.rule_id,
            severity: findingDoc.severity,
            description: findingDoc.description,
            package_name: findingDoc.package_name,
            fixed_version: findingDoc.fixed_version
        };

        if (type === 'slack') {
            await AlertService.sendSlackAlert(webhookUrl, [finding], findingDoc.scan_id, repoName || 'Repository', FRONTEND_URL);
        } else {
            await AlertService.sendDiscordAlert(webhookUrl, [finding], findingDoc.scan_id, repoName || 'Repository', FRONTEND_URL);
        }

        res.status(200).json({ success: true });
    } catch (error: unknown) {
        logger.error('[Alerts] notify failed', {
            event: 'ALERT_NOTIFY_FAILED', findingId: req.body?.findingId, channel: req.body?.type, ...errorContext(error),
        });
        res.status(500).json({ error: 'Failed to send alert' });
    }
});

router.post('/batch-notify', async (req: AuthenticatedRequest, res) => {
    try {
        const { scanId, repoName, severities } = req.body;

        // Use user object attached by auth middleware if present, else fallback
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Fetch user integrations
        const integrationsResponse = await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS, [
            Query.equal('userId', user.$id)
        ]);

        if (integrationsResponse.total === 0) {
            return res.status(200).json({ message: 'No integrations configured' });
        }

        const integration = integrationsResponse.documents[0];
        if (!integration.isEnabled) {
            return res.status(200).json({ message: 'Integrations disabled' });
        }

        const discordUrl = integration.discord_webhook;
        const slackUrl = integration.slack_webhook;

        if (!discordUrl && !slackUrl) {
            return res.status(200).json({ message: 'No active webhooks' });
        }

        // Verify the caller actually owns the scan before relaying its findings
        // into their own integration - otherwise a guessed/foreign scanId would
        // leak another tenant's finding details to the caller's webhook.
        const scanDoc = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId).catch(() => null);
        const scanRepo = scanDoc?.repo_id
            ? await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, scanDoc.repo_id).catch(() => null)
            : null;
        if (!scanRepo || !(await canAccessResource(scanRepo, user.$id))) {
            return res.status(403).json({ error: 'You do not have access to this scan' });
        }

        // Fetch findings
        let queries = [Query.equal('scan_id', scanId)];
        const findingsRes = await databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, queries);
        
        // Filter by configured severities (e.g. ['critical', 'high'])
        const activeSeverities = severities || ['critical', 'high'];
        const matchedFindings = findingsRes.documents.filter(doc => 
            activeSeverities.includes(doc.severity?.toLowerCase())
        );

        if (matchedFindings.length === 0) {
            return res.status(200).json({ message: 'No findings match configured severities' });
        }

        const mappedFindings = matchedFindings.map(doc => ({
            vulnerability_id: doc.vulnerability_id,
            rule_id: doc.rule_id,
            severity: doc.severity,
            description: doc.description,
            package_name: doc.package_name,
            fixed_version: doc.fixed_version
        }));

        const promises = [];
        if (discordUrl) {
            promises.push(AlertService.sendDiscordAlert(discordUrl, mappedFindings, scanId, repoName, FRONTEND_URL));
        }
        if (slackUrl) {
            promises.push(AlertService.sendSlackAlert(slackUrl, mappedFindings, scanId, repoName, FRONTEND_URL));
        }

        await Promise.allSettled(promises);

        res.status(200).json({ success: true, count: mappedFindings.length });
    } catch (error: unknown) {
        logger.error('[Alerts] bulk send failed', { event: 'ALERT_BULK_SEND_FAILED', ...errorContext(error) });
        res.status(500).json({ error: 'Failed to send alerts' });
    }
});

/**
 * Alert integration settings for the calling user.
 *
 * These documents hold Discord and Slack webhook URLs plus PagerDuty and
 * Opsgenie keys — credentials, not preferences. Anyone holding a webhook URL
 * can post into that channel. They were previously read and written straight
 * from the browser, so Appwrite collection permissions were the only boundary.
 *
 * The owning user is always taken from the verified session. The client cannot
 * name a userId or a document id, which is what stops one tenant overwriting
 * another's integration by passing its id.
 */
const INTEGRATION_FIELDS = [
    'discord_webhook', 'slack_webhook', 'pagerduty_key', 'opsgenie_key',
] as const;

type IntegrationDocument = Models.Document & {
    discord_webhook?: string;
    slack_webhook?: string;
    pagerduty_key?: string;
    opsgenie_key?: string;
    isEnabled?: boolean;
    activeSeverities?: string[];
};

async function findIntegrationForUser(userId: string): Promise<IntegrationDocument | null> {
    const existing = await databases.listDocuments<IntegrationDocument>(
        DB_ID,
        COLLECTIONS.INTEGRATIONS,
        [Query.equal('userId', userId), Query.limit(1)],
    );
    return existing.total > 0 ? existing.documents[0] : null;
}

router.get('/integrations', async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user?.$id;
        if (!userId) return res.status(401).json({ error: 'Authentication required' });

        const doc = await findIntegrationForUser(userId);
        if (!doc) {
            // No integration yet is a normal state, not an error.
            return res.json({ configured: false });
        }

        res.json({
            configured: true,
            discord_webhook: doc.discord_webhook || '',
            slack_webhook: doc.slack_webhook || '',
            pagerduty_key: doc.pagerduty_key || '',
            opsgenie_key: doc.opsgenie_key || '',
            isEnabled: doc.isEnabled ?? true,
            activeSeverities: doc.activeSeverities || ['critical', 'high'],
        });
    } catch (error: unknown) {
        logger.error('[Alerts] integration read failed', {
            event: 'ALERT_INTEGRATION_READ_FAILED', userId: req.user?.$id, ...errorContext(error),
        });
        res.status(500).json({ error: 'Failed to load alert integrations' });
    }
});

// Gated: configuring an integration registers an outbound sink this server will
// then POST to. Combined with the SSRF guard already on the URL, that keeps an
// unverified account from pointing the server anywhere at all.
router.put('/integrations', requireEmailVerification, async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user?.$id;
        if (!userId) return res.status(401).json({ error: 'Authentication required' });

        const { isEnabled, activeSeverities } = req.body;

        const settings: Record<string, unknown> = {};
        for (const field of INTEGRATION_FIELDS) {
            settings[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : '';
        }

        // Validate before storing: the backend later POSTs to these URLs itself
        // (batch-notify), so an unchecked value is an SSRF primitive that
        // outlives the request that set it.
        for (const field of ['discord_webhook', 'slack_webhook'] as const) {
            const url = settings[field] as string;
            if (!url) continue;
            try {
                await assertSafeWebhookUrl(url);
            } catch (err: unknown) {
                return res.status(400).json({ error: `${field}: ${errorMessage(err)}` });
            }
        }

        if (activeSeverities !== undefined && !Array.isArray(activeSeverities)) {
            return res.status(400).json({ error: 'activeSeverities must be an array' });
        }

        const data = {
            ...settings,
            userId,
            isEnabled: isEnabled ?? true,
            activeSeverities: activeSeverities ?? ['critical', 'high'],
            integrationType: 'webhook',
        };

        // Look the document up by owner rather than accepting an id from the
        // client — an id would let a caller target someone else's row.
        const existing = await findIntegrationForUser(userId);
        const saved = existing
            ? await databases.updateDocument(DB_ID, COLLECTIONS.INTEGRATIONS, existing.$id, data)
            : await databases.createDocument(DB_ID, COLLECTIONS.INTEGRATIONS, ID.unique(), data);

        res.json({ success: true, configured: true, id: saved.$id });
    } catch (error: unknown) {
        logger.error('[Alerts] integration save failed', {
            event: 'ALERT_INTEGRATION_SAVE_FAILED', userId: req.user?.$id, ...errorContext(error),
        });
        res.status(500).json({ error: 'Failed to save alert integrations' });
    }
});

export default router;
