import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:3000';

interface ScanCreateResponse {
    scan_id: string;
}

interface ScanStatusResponse {
    scan: {
        id: string;
        status: string;
    };
    vulnerabilities: Array<{
        id: string;
        severity: string;
        title: string;
        file_path?: string;
    }>;
}

async function testScan() {
    const repoUrl = 'https://github.com/vulnerable-repo/test-repo';
    console.log(`[Test] Triggering scan for ${repoUrl}...`);

    try {
        const postRes = await axios.post<ScanCreateResponse>(`${API_URL}/scan`, { repo_url: repoUrl });
        const { scan_id } = postRes.data;
        console.log(`[Test] Scan Created: ${scan_id}`);

        let completed = false;
        let attempts = 0;

        while (!completed && attempts < 30) {
            const getRes = await axios.get<ScanStatusResponse>(`${API_URL}/scan/${scan_id}`);
            const { scan, vulnerabilities } = getRes.data;

            console.log(`[Test] Status: ${scan.status} (${vulnerabilities.length} vulnerabilities)`);

            if (scan.status === 'completed' || scan.status === 'failed') {
                completed = true;
                console.log('[Test] Scan Finished!');
                console.log('[Test] Final Scan Data:', scan);
                console.log('[Test] Vulnerabilities Sample:', vulnerabilities.slice(0, 3));
            } else {
                await new Promise(r => setTimeout(r, 5000));
                attempts++;
            }
        }

        if (!completed) {
            console.error('[Test] Timeout waiting for scan to complete');
        }

    } catch (error: any) {
        console.error('[Test] Error:', error.response?.data || error.message);
    }
}

testScan();
