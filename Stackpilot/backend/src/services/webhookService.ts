import axios from 'axios';

export interface WebhookPayload {
    text: string;
    attachments?: any[];
}

export const sendSlackWebhook = async (url: string, payload: WebhookPayload) => {
    try {
        await axios.post(url, payload);
        return { success: true };
    } catch (error: any) {
        console.error(`[WebhookService] Slack failed: ${error.message}`);
        return { success: false, error: error.message };
    }
};

export const sendDiscordWebhook = async (url: string, payload: WebhookPayload) => {
    try {
        // Discord uses a slightly different format but often accepts Slack's
        await axios.post(url, payload);
        return { success: true };
    } catch (error: any) {
        console.error(`[WebhookService] Discord failed: ${error.message}`);
        return { success: false, error: error.message };
    }
};

export const formatSlackScanResult = (projectName: string, score: number, vulns: number, url: string) => {
    const color = score > 80 ? '#2eb886' : score > 50 ? '#daa038' : '#a30200';
    return {
        text: `🛡️ *StackPilot Scan Result*: ${projectName}`,
        attachments: [
            {
                color,
                fields: [
                    { title: 'Security Score', value: `${score}/100`, short: true },
                    { title: 'Vulnerabilities', value: `${vulns}`, short: true },
                    { title: 'Project URL', value: `<${url}|View Dashboard>`, short: false }
                ]
            }
        ]
    };
};
