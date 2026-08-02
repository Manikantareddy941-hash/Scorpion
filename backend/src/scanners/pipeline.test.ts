// Only orchestrateScan is stubbed. assertScannersUsable stays real: it is the
// behaviour under test here, and a mocked-away guard would let these tests pass
// against a pipeline that never checks anything.
jest.mock('../services/scan/orchestrator', () => ({
    ...jest.requireActual('../services/scan/orchestrator'),
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

    it('returns empty-but-parseable results when the scanners genuinely found nothing', async () => {
        (orchestrateScan as jest.Mock).mockResolvedValue([
            { tool: 'semgrep', stdout: JSON.stringify({ results: [] }), stderr: '', status: 0 },
            { tool: 'trivy', stdout: '', stderr: '', status: 0 },
            { tool: 'gitleaks', stdout: '', stderr: '', status: 0 },
        ]);

        const result = await runScanPipeline({ localPath: '/tmp/some-repo' });

        expect(result.trivy).toEqual({});
        expect(result.gitleaks).toEqual({});
    });

    // This case used to return `{ trivy: {} }` — a scanner that never ran,
    // reported to the policy engine as zero findings. The previous version of
    // this test asserted that behaviour, which is how it survived.
    it('aborts rather than reporting zero findings for a scanner that never ran', async () => {
        (orchestrateScan as jest.Mock).mockResolvedValue([
            { tool: 'semgrep', stdout: JSON.stringify({ results: [] }), stderr: '', status: 0 },
            { tool: 'gitleaks', stdout: '[]', stderr: '', status: 0 },
            { tool: 'trivy', stdout: '', stderr: 'spawn ENOENT', error: 'spawn ENOENT', status: null, unavailable: true },
        ]);

        await expect(runScanPipeline({ localPath: '/tmp/some-repo' })).rejects.toThrow(/trivy/);
    });

    it('aborts when a scanner the gate depends on left no result at all', async () => {
        (orchestrateScan as jest.Mock).mockResolvedValue([
            { tool: 'semgrep', stdout: JSON.stringify({ results: [] }), stderr: '', status: 0 },
        ]);

        await expect(runScanPipeline({ localPath: '/tmp/some-repo' })).rejects.toThrow(/trivy|gitleaks/);
    });

    it('does not abort on a scanner whose output the gate never reads', async () => {
        // checkov findings are not carried in ScanPipelineResult, so its failure
        // cannot corrupt the verdict — failing the pipeline on it would block
        // merges for a reason that has no bearing on the decision.
        (orchestrateScan as jest.Mock).mockResolvedValue([
            { tool: 'semgrep', stdout: JSON.stringify({ results: [] }), stderr: '', status: 0 },
            { tool: 'gitleaks', stdout: '[]', stderr: '', status: 0 },
            { tool: 'trivy', stdout: '{}', stderr: '', status: 0 },
            { tool: 'checkov', stdout: '', stderr: 'no binary', error: 'no binary', status: null, unavailable: true },
        ]);

        await expect(runScanPipeline({ localPath: '/tmp/some-repo' })).resolves.toBeDefined();
    });

    it('rejects when neither localPath nor cloneUrl/branch is provided', async () => {
        await expect(runScanPipeline({})).rejects.toThrow('Either localPath or cloneUrl/branch must be provided');
        expect(orchestrateScan).not.toHaveBeenCalled();
    });
});
