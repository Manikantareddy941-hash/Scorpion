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
    }
};
