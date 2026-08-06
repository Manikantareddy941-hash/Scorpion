import axios from 'axios';
import { Databases, Query, Models } from 'node-appwrite';
import client, { DB_ID } from '../lib/appwrite';
import { logger } from '../services/logger';

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

/**
 * Platform-level alerting, as opposed to per-tenant finding alerts.
 *
 * WHY THIS DOES NOT REUSE sendFindingAlert's ROUTING
 *
 * That function resolves destinations from the `integrations` document belonging
 * to a userId. A scheduled worker has no user. Borrowing some admin's row would
 * tie infrastructure alerting to a record that can be edited or deleted by the
 * person least likely to notice they had silenced the ledger alarm. These
 * destinations come from the environment instead, alongside every other
 * deployment secret.
 *
 * TWO CHANNELS, ON PURPOSE
 *
 * 'security' is for evidence the audit ledger was modified — it should reach
 * whoever responds to an intrusion. 'ops' is for the infrastructure being unable
 * to answer, such as Loki unreachable, which is a different job on a different
 * rota. Routing both to one destination is how the security signal gets buried
 * under the operational noise.
 */
export type SystemAlertChannel = 'security' | 'ops';

export interface SystemAlert {
    channel: SystemAlertChannel;
    title: string;
    detail: string;
    /** Groups a recurring condition into one incident rather than one per run. */
    dedupKey?: string;
}

export interface SystemAlertResult {
    /** Destinations that accepted the alert. */
    delivered: number;
    /** Destinations configured for this channel. Zero means nobody was told. */
    configured: number;
}

/** Bounded so a hung webhook cannot stall a worker holding a queue lock. */
const SYSTEM_ALERT_TIMEOUT_MS = 10_000;

function destinationsFor(channel: SystemAlertChannel) {
    const prefix = channel === 'security' ? 'SECURITY_ALERT' : 'OPS_ALERT';
    return {
        slack: process.env[`${prefix}_SLACK_WEBHOOK`],
        pagerduty: process.env[`${prefix}_PAGERDUTY_KEY`],
    };
}

/**
 * Returns what actually happened rather than resolving silently.
 *
 * `configured: 0` is the case worth caring about: an alert with nowhere to go is
 * indistinguishable from no alert, and a caller that ignores this result has
 * built a tamper alarm with the wires cut. Callers are expected to log it.
 *
 * Individual transport failures are caught per destination so one dead webhook
 * cannot suppress the others, but they are reflected in `delivered`.
 */
export async function sendSystemAlert(alert: SystemAlert): Promise<SystemAlertResult> {
    const { slack, pagerduty } = destinationsFor(alert.channel);
    const configured = [slack, pagerduty].filter(Boolean).length;
    let delivered = 0;

    if (slack) {
        try {
            await axios.post(slack, {
                blocks: [{
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*[${alert.channel.toUpperCase()}] ${alert.title}*\n${alert.detail}`,
                    },
                }],
            }, { timeout: SYSTEM_ALERT_TIMEOUT_MS });
            delivered += 1;
        } catch (err) {
            logger.error('[System Alert] Slack delivery failed:', err instanceof Error ? err.message : err);
        }
    }

    if (pagerduty) {
        try {
            await axios.post('https://events.pagerduty.com/v2/enqueue', {
                routing_key: pagerduty,
                event_action: 'trigger',
                dedup_key: alert.dedupKey,
                payload: {
                    summary: alert.title,
                    // A security-channel alert is always critical: the only thing
                    // routed here is evidence the audit trail itself changed.
                    severity: alert.channel === 'security' ? 'critical' : 'warning',
                    source: 'scorpion',
                    custom_details: { detail: alert.detail },
                },
            }, { timeout: SYSTEM_ALERT_TIMEOUT_MS });
            delivered += 1;
        } catch (err) {
            logger.error('[System Alert] PagerDuty delivery failed:', err instanceof Error ? err.message : err);
        }
    }

    return { delivered, configured };
}

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
            logger.info(`[Alert] Skipping alert for ${finding.title} (Severity: ${finding.severity} < ${minSeverity})`);
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
                logger.info(`[Alert] Discord notification sent for ${finding.title}`);
            } catch (err: any) {
                logger.error(`[Alert Error] Discord:`, err.message);
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
                logger.info(`[Alert] Slack notification sent for ${finding.title}`);
            } catch (err: any) {
                logger.error(`[Alert Error] Slack:`, err.message);
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
                logger.info(`[Alert] PagerDuty event triggered for ${finding.title}`);
            } catch (err: any) {
                logger.error(`[Alert Error] PagerDuty:`, err.message);
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
                logger.info(`[Alert] OpsGenie alert created for ${finding.title}`);
            } catch (err: any) {
                logger.error(`[Alert Error] OpsGenie:`, err.message);
            }
        }

    } catch (err: any) {
        logger.error(`[Alert Dispatcher Error]`, err.message);
    }
}
