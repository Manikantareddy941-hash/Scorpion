import axios from 'axios';
import { Databases, Query, Models } from 'node-appwrite';
import { client, DB_ID } from '../lib/appwrite';

const databases = new Databases(client);

export interface FindingDocument extends Models.Document {
    repo_id: string;
    repo_name: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    file_path: string;
    line_number?: number;
    cve_id?: string;
    created_at: string;
    status: string;
    scanId: string;
}

const SEVERITY_LEVELS: Record<string, number> = {
    'critical': 4,
    'high': 3,
    'medium': 2,
    'low': 1
};

const SEVERITY_COLORS: Record<string, number> = {
    'critical': 15548997,
    'high': 15105570,
    'medium': 16776960,
    'low': 65280
};

export async function sendFindingAlert(finding: FindingDocument, userId: string) {
    try {
        // 1. Fetch user's integration prefs
        const response = await databases.listDocuments(
            DB_ID,
            'integrations',
            [Query.equal('userId', userId), Query.limit(1)]
        );

        if (response.total === 0) return;

        const integration = response.documents[0] as any;
        if (!integration.isEnabled) return;

        // 2. Check severity threshold
        const minSeverity = integration.min_severity || 'low';
        const currentLevel = SEVERITY_LEVELS[finding.severity.toLowerCase()] || 0;
        const minLevel = SEVERITY_LEVELS[minSeverity.toLowerCase()] || 0;

        if (currentLevel < minLevel) {
            console.log(`[Alert] Skipping alert for ${finding.title} (Severity: ${finding.severity} < ${minSeverity})`);
            return;
        }

        // 3. Send to Discord
        if (integration.discord_webhook) {
            try {
                await axios.post(integration.discord_webhook, {
                    embeds: [{
                        title: `🚨 ${finding.title}`,
                        description: finding.description,
                        color: SEVERITY_COLORS[finding.severity.toLowerCase()] || 16777215,
                        fields: [
                            { name: 'Repository', value: finding.repo_name, inline: true },
                            { name: 'Type', value: finding.type, inline: true },
                            { name: 'File', value: finding.file_path, inline: false },
                            { name: 'CVE ID', value: finding.cve_id || 'N/A', inline: true }
                        ],
                        timestamp: new Date().toISOString()
                    }]
                });
                console.log(`[Alert] Discord notification sent for ${finding.title}`);
            } catch (err: any) {
                console.error(`[Alert Error] Discord:`, err.message);
            }
        }

        // 4. Send to Slack
        if (integration.slack_webhook) {
            try {
                await axios.post(integration.slack_webhook, {
                    blocks: [{
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `*${finding.severity.toUpperCase()} finding: ${finding.title}*\n*Repo:* ${finding.repo_name}\n*Type:* ${finding.type}\n*File:* ${finding.file_path}`
                        }
                    }]
                });
                console.log(`[Alert] Slack notification sent for ${finding.title}`);
            } catch (err: any) {
                console.error(`[Alert Error] Slack:`, err.message);
            }
        }

        // 5. Send to PagerDuty
        if (integration.pagerduty_key) {
            try {
                const pdSeverityMap: Record<string, string> = {
                    'critical': 'critical',
                    'high': 'error',
                    'medium': 'warning',
                    'low': 'info'
                };
                await axios.post('https://events.pagerduty.com/v2/enqueue', {
                    routing_key: integration.pagerduty_key,
                    event_action: "trigger",
                    payload: {
                        summary: `[${finding.severity.toUpperCase()}] ${finding.title} in ${finding.repo_name}`,
                        severity: pdSeverityMap[finding.severity.toLowerCase()] || 'info',
                        source: "scorpion",
                        custom_details: {
                            type: finding.type,
                            file_path: finding.file_path,
                            cve_id: finding.cve_id,
                            repo_name: finding.repo_name
                        }
                    }
                });
                console.log(`[Alert] PagerDuty event triggered for ${finding.title}`);
            } catch (err: any) {
                console.error(`[Alert Error] PagerDuty:`, err.message);
            }
        }

        // 6. Send to OpsGenie
        if (integration.opsgenie_key) {
            try {
                const ogPriorityMap: Record<string, string> = {
                    'critical': 'P1',
                    'high': 'P2',
                    'medium': 'P3',
                    'low': 'P4'
                };
                await axios.post('https://api.opsgenie.com/v2/alerts', {
                    message: `[${finding.severity.toUpperCase()}] ${finding.title}`,
                    description: finding.description,
                    priority: ogPriorityMap[finding.severity.toLowerCase()] || 'P4',
                    tags: ["scorpion", finding.type, finding.repo_name]
                }, {
                    headers: {
                        'Authorization': `GenieKey ${integration.opsgenie_key}`
                    }
                });
                console.log(`[Alert] OpsGenie alert created for ${finding.title}`);
            } catch (err: any) {
                console.error(`[Alert Error] OpsGenie:`, err.message);
            }
        }

    } catch (err: any) {
        console.error(`[Alert Dispatcher Error]`, err.message);
    }
}
