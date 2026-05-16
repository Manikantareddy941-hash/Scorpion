import axios from 'axios';

export const sendSlackNotification = async (webhookUrl: string, payload: any) => {
    try {
        const severityStr = (payload.severity || 'UNKNOWN').toUpperCase();
        
        // Map severity to an emoji for better visual cues
        let severityEmoji = '⚪';
        if (severityStr === 'CRITICAL') severityEmoji = '🔴';
        else if (severityStr === 'HIGH') severityEmoji = '🟠';
        else if (severityStr === 'MEDIUM') severityEmoji = '🟡';
        else if (severityStr === 'LOW') severityEmoji = '🔵';

        const dashboardUrl = payload.incidentId 
            ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/incidents/${payload.incidentId}`
            : `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`;

        const slackPayload = {
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: `🔴 SCORPION SECURITY ALERT`,
                        emoji: true
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Alert Title:*\n${payload.title || 'Runtime Threat Detected'}`
                    }
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*Repository:*\n${payload.repository || 'Global / Unknown'}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Severity:*\n${severityEmoji} ${severityStr}`
                        }
                    ]
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Rule:*\n\`${payload.rule || 'N/A'}\``
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `<${dashboardUrl}|*View Incident in Scorpion Dashboard* 🔍>`
                    }
                }
            ]
        };

        const response = await axios.post(webhookUrl, slackPayload);
        return response.data;
    } catch (error: any) {
        console.error('[SlackService] Error sending notification:', error.message);
        throw error;
    }
};
