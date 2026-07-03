import { runNuclei, NucleiResult } from '../services/nucleiService';
import { runDastWorker, mapDastSeverity, DastWorkerPayload } from './dastWorkerRunner';

export interface NucleiWorkerPayload extends DastWorkerPayload {
    tags?: string;
}

const firstCveOrCwe = (result: NucleiResult): string => {
    const cls = result.info?.classification;
    return cls?.['cve-id']?.[0] || cls?.['cwe-id']?.[0] || '';
};

export const runNucleiScan = async (payload: NucleiWorkerPayload) => {
    const { targetUrl, tags } = payload;

    await runDastWorker({
        tool: 'nuclei',
        label: 'Nuclei Worker',
        payload,
        detailsExtra: () => ({ tags: tags || null }),
        run: async () => {
            const results = await runNuclei(targetUrl, tags);

            return results.map((r) => ({
                type: 'dast',
                tool: 'nuclei',
                severity: mapDastSeverity(r.info?.severity),
                title: r.info?.name || r['template-id'] || 'Nuclei finding',
                description: r.info?.description || '',
                filePath: r['matched-at'] || r.host || targetUrl,
                solution: r.info?.remediation || '',
                cveId: firstCveOrCwe(r),
                status: 'open',
                detected_at: new Date().toISOString()
            }));
        }
    });
};
