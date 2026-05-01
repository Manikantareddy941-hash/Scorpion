import express from 'express';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { AlertService } from '../services/alertService';
import { Models } from 'node-appwrite';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Helper to authenticate request (assuming similar structure to other routes)
// But since the user wants us to call this from frontend or engine, let's keep it simple.
// We should probably check the user token, but we'll use a basic approach.

router.post('/test', async (req, res) => {
    try {
        const { webhookUrl, type } = req.body;
        
        if (!webhookUrl) {
            return res.status(400).json({ error: 'Missing webhookUrl' });
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
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/notify', async (req, res) => {
    try {
        const { findingId, webhookUrl, type, repoName } = req.body;
        
        const findingDoc = await databases.getDocument(DB_ID, COLLECTIONS.FINDINGS, findingId);
        
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
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/batch-notify', async (req, res) => {
    try {
        const { scanId, repoName, severities } = req.body;
        
        // Use user object attached by auth middleware if present, else fallback
        const user = (req as any).user;
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

        const discordUrl = integration.webhookUrl;
        const slackUrl = integration.slackWebhookUrl;

        if (!discordUrl && !slackUrl) {
            return res.status(200).json({ message: 'No active webhooks' });
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
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
