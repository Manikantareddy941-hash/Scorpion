import { runFfuf, FfufResult } from '../services/ffufService';
import { runDastWorker, DastWorkerPayload } from './dastWorkerRunner';

export interface FfufWorkerPayload extends DastWorkerPayload {
    rate?: number;
}

export const runFfufScan = async (payload: FfufWorkerPayload) => {
    const { targetUrl, rate } = payload;

    await runDastWorker({
        tool: 'ffuf',
        label: 'ffuf Worker',
        payload,
        run: async () => {
            const results = await runFfuf(targetUrl, { rate });

            // A discovered endpoint is attack surface, not inherently a vulnerability,
            // so everything maps to INFO. The gate treats INFO as non-blocking.
            return results.map((r: FfufResult) => ({
                type: 'dast',
                tool: 'ffuf',
                severity: 'INFO',
                title: `Discovered endpoint: /${r.input?.FUZZ ?? ''}`,
                description: `ffuf received HTTP ${r.status} (length ${r.length}) at ${r.url}`,
                filePath: r.url || targetUrl,
                status: 'open',
                detected_at: new Date().toISOString()
            }));
        }
    });
};
