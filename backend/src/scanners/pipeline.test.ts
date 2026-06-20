jest.mock('../services/scan/orchestrator', () => ({
    orchestrateScan: jest.fn(),
}));
jest.mock('../utils/git', () => ({
    cloneRepo: jest.fn(),
}));

import { runScanPipeline } from './pipeline';
import { orchestrateScan } from '../services/scan/orchestrator';

describe('runScanPipeline', () => {
    beforeEach(() => jest.clearAllMocks());

    it('calls the real orchestrator and parses each tool\'s stdout, not a stub', async () => {
        (orchestrateScan as jest.Mock).mockResolvedValue([
            { tool: 'semgrep', stdout: JSON.stringify({ results: [{ check_id: 'rule-1' }] }), stderr: '', status: 0 },
            { tool: 'gitleaks', stdout: JSON.stringify([{ RuleID: 'secret-1' }]), stderr: '', status: 0 },
            { tool: 'trivy', stdout: JSON.stringify({ Results: [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-1' }] }] }), stderr: '', status: 0 },
        ]);

        const result = await runScanPipeline({ localPath: '/tmp/some-repo' });

        expect(orchestrateScan).toHaveBeenCalledWith('/tmp/some-repo', { scanType: 'full' });
        expect(result.semgrep.results).toEqual([{ check_id: 'rule-1' }]);
        expect(result.gitleaks).toEqual([{ RuleID: 'secret-1' }]);
        expect(result.trivy.Results).toEqual([{ Vulnerabilities: [{ VulnerabilityID: 'CVE-1' }] }]);
    });

    it('returns empty-but-parseable results for a tool the orchestrator found nothing for', async () => {
        (orchestrateScan as jest.Mock).mockResolvedValue([
            { tool: 'semgrep', stdout: JSON.stringify({ results: [] }), stderr: '', status: 0 },
        ]);

        const result = await runScanPipeline({ localPath: '/tmp/some-repo' });

        expect(result.trivy).toEqual({});
        expect(result.gitleaks).toEqual([]);
    });

    it('rejects when neither localPath nor cloneUrl/branch is provided', async () => {
        await expect(runScanPipeline({})).rejects.toThrow('Either localPath or cloneUrl/branch must be provided');
        expect(orchestrateScan).not.toHaveBeenCalled();
    });
});
