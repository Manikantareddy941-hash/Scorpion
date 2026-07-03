import axios from 'axios';

const ZAP_BASE_URL = process.env.ZAP_BASE_URL || 'http://localhost:8080';
const ZAP_API_KEY = process.env.ZAP_API_KEY || '';

const getZapClient = () => {
    return axios.create({
        baseURL: ZAP_BASE_URL,
        headers: {
            'X-ZAP-API-Key': ZAP_API_KEY,
            'Accept': 'application/json'
        }
    });
};

export const zapService = {
    /**
     * Start a ZAP Spider scan on a target URL
     */
    startSpider: async (targetUrl: string): Promise<string> => {
        const client = getZapClient();
        const response = await client.get('/JSON/spider/action/scan/', {
            params: { url: targetUrl }
        });
        return response.data.scan;
    },

    /**
     * Get Spider scan status (0-100)
     */
    getSpiderStatus: async (scanId: string): Promise<number> => {
        const client = getZapClient();
        const response = await client.get('/JSON/spider/view/status/', {
            params: { scanId }
        });
        return parseInt(response.data.status, 10);
    },

    /**
     * Start an Active Scan on a target URL
     */
    startActiveScan: async (targetUrl: string): Promise<string> => {
        const client = getZapClient();
        const response = await client.get('/JSON/ascan/action/scan/', {
            params: { url: targetUrl }
        });
        return response.data.scan;
    },

    /**
     * Get Active Scan status (0-100)
     */
    getActiveScanStatus: async (scanId: string): Promise<number> => {
        const client = getZapClient();
        const response = await client.get('/JSON/ascan/view/status/', {
            params: { scanId }
        });
        return parseInt(response.data.status, 10);
    },

    /**
     * Enable/Disable Passive Scanning
     */
    setPassiveScanEnabled: async (enabled: boolean): Promise<void> => {
        const client = getZapClient();
        await client.get('/JSON/pscan/action/setEnabled/', {
            params: { enabled: enabled ? 'true' : 'false' }
        });
    },

    /**
     * Get all alerts for a target URL
     */
    getAlerts: async (targetUrl: string): Promise<any[]> => {
        const client = getZapClient();
        const response = await client.get('/JSON/alert/view/alerts/', {
            params: { baseurl: targetUrl }
        });
        return response.data.alerts || [];
    },

    /**
     * Inject an `Authorization: Bearer <token>` header on every outgoing ZAP
     * request via a replacer rule, so the spider/active scan can reach routes
     * behind bearer-token auth. `ruleName` must be removed afterwards
     * (see removeBearerToken) so the token never bleeds into another scan.
     */
    setBearerToken: async (ruleName: string, token: string): Promise<void> => {
        const client = getZapClient();
        await client.get('/JSON/replacer/action/addRule/', {
            params: {
                description: ruleName,
                enabled: 'true',
                matchType: 'REQ_HEADER',
                matchRegex: 'false',
                matchString: 'Authorization',
                replacement: `Bearer ${token}`,
            }
        });
    },

    /**
     * Remove a previously added bearer-token replacer rule. Safe to call even
     * if the rule was never added (ZAP returns an error we intentionally
     * swallow) so it can live in a finally block.
     */
    removeBearerToken: async (ruleName: string): Promise<void> => {
        const client = getZapClient();
        try {
            await client.get('/JSON/replacer/action/removeRule/', {
                params: { description: ruleName }
            });
        } catch {
            // Rule absent or already removed — nothing to clean up.
        }
    }
};
