import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const CONCURRENT_SCANS = 10;
const TEST_REPO = 'https://github.com/vulnerable-repo/test-repo'; // Use a real small public repo if possible

async function runStressTest() {
    console.log(`[StressTest] Starting stress test with ${CONCURRENT_SCANS} parallel scans...`);

    const startTime = Date.now();
    const scanIds: string[] = [];

    // 1. Submit parallel scans
    for (let i = 0; i < CONCURRENT_SCANS; i++) {
        try {
            const res = await axios.post(`${API_URL}/scan`, { repo_url: TEST_REPO });
            scanIds.push(res.data.scan_id);
            console.log(`[StressTest] Submitted scan ${i + 1}/${CONCURRENT_SCANS}: ${res.data.scan_id}`);
        } catch (error: any) {
            console.error(`[StressTest] Failed to submit scan ${i + 1}:`, error.response?.data || error.message);
        }
    }

    console.log(`[StressTest] Waiting for ${scanIds.length} scans to complete...`);

    // 2. Poll for completion
    const results = new Map<string, string>();
    const finishedIds = new Set<string>();

    while (finishedIds.size < scanIds.length) {
        for (const id of scanIds) {
            if (finishedIds.has(id)) continue;

            try {
                const res = await axios.get(`${API_URL}/scan/${id}`);
                const status = res.data.scan.status;
                if (status === 'completed' || status === 'failed') {
                    finishedIds.add(id);
                    results.set(id, status);
                    console.log(`[StressTest] Scan ${id} finished with status: ${status}`);
                }
            } catch (error: any) {
                console.error(`[StressTest] Error polling scan ${id}:`, error.message);
            }
        }
        if (finishedIds.size < scanIds.length) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('\n--- STRESS TEST RESULTS ---');
    console.log(`Total Scans: ${scanIds.length}`);
    console.log(`Completed: ${Array.from(results.values()).filter(s => s === 'completed').length}`);
    console.log(`Failed: ${Array.from(results.values()).filter(s => s === 'failed').length}`);
    console.log(`Total Duration: ${duration.toFixed(2)}s`);
    console.log('---------------------------\n');
}

runStressTest().catch(console.error);
