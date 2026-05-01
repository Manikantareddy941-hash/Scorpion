import axios from 'axios';

interface Finding {
    vulnerability_id?: string;
    rule_id?: string;
    package_name?: string;
    severity: string;
    description?: string;
    fixed_version?: string;
}

const getSeverityColor = (severity: string): number => {
    switch (severity.toLowerCase()) {
        case 'critical': return 16711680; // Red
        case 'high': return 16753920;     // Orange
        case 'medium': return 16776960;   // Yellow
        case 'low': return 65280;         // Green
        default: return 8421504;          // Gray
    }
};

const getSeverityHex = (severity: string): string => {
    switch (severity.toLowerCase()) {
        case 'critical': return '#FF0000';
        case 'high': return '#FFA500';
        case 'medium': return '#FFFF00';
        case 'low': return '#00FF00';
        default: return '#808080';
    }
};

export class AlertService {
    static async sendDiscordAlert(webhookUrl: string, findings: Finding[], scanId: string, repoName: string, frontendUrl: string) {
        if (!webhookUrl || findings.length === 0) return;

        const embeds = findings.map(finding => {
            const title = finding.vulnerability_id || finding.rule_id || 'Security Finding';
            const pkg = finding.package_name ? `**Package**: ${finding.package_name}\n` : '';
            const fix = finding.fixed_version ? `**Fix Version**: ${finding.fixed_version}\n` : '';
            const desc = finding.description ? `${finding.description.substring(0, 500)}${finding.description.length > 500 ? '...' : ''}` : '';

            return {
                title: `[${finding.severity.toUpperCase()}] ${title}`,
                description: `${pkg}${fix}\n${desc}`,
                color: getSeverityColor(finding.severity),
                url: `${frontendUrl}/scans/${scanId}`
            };
        });

        // Discord limit is 10 embeds per message
        for (let i = 0; i < embeds.length; i += 10) {
            const chunk = embeds.slice(i, i + 10);
            try {
                await axios.post(webhookUrl, {
                    content: i === 0 ? `🚨 **SCORPION Security Alert** | Scan completed for **${repoName}** with ${findings.length} findings.` : null,
                    embeds: chunk
                });
            } catch (error: any) {
                console.error(`Failed to send Discord alert: ${error.message}`);
            }
        }
    }

    static async sendSlackAlert(webhookUrl: string, findings: Finding[], scanId: string, repoName: string, frontendUrl: string) {
        if (!webhookUrl || findings.length === 0) return;

        const scanUrl = `${frontendUrl}/scans/${scanId}`;
        
        // Slack limits blocks, we'll send a summary + max 10 top findings
        const blocks: any[] = [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: `🚨 SCORPION Security Alert: ${repoName}`,
                    emoji: true
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `Scan completed with *${findings.length}* new findings.\n<${scanUrl}|View Full Scan Results>`
                }
            },
            { type: "divider" }
        ];

        const topFindings = findings.slice(0, 10);
        topFindings.forEach(finding => {
            const title = finding.vulnerability_id || finding.rule_id || 'Security Finding';
            const pkg = finding.package_name ? `*Package*: ${finding.package_name}` : '';
            const fix = finding.fixed_version ? `*Fix*: ${finding.fixed_version}` : '';
            
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*[${finding.severity.toUpperCase()}]* ${title}\n${pkg} | ${fix}\n${finding.description ? finding.description.substring(0, 150) + '...' : ''}`
                }
            });
        });

        if (findings.length > 10) {
            blocks.push({
                type: "context",
                elements: [
                    {
                        type: "mrkdwn",
                        text: `...and ${findings.length - 10} more findings. View the full report in SCORPION.`
                    }
                ]
            });
        }

        blocks.push({
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "View Scan Details",
                        emoji: true
                    },
                    url: scanUrl,
                    style: "danger"
                }
            ]
        });

        try {
            await axios.post(webhookUrl, { blocks });
        } catch (error: any) {
            console.error(`Failed to send Slack alert: ${error.message}`);
        }
    }
}
