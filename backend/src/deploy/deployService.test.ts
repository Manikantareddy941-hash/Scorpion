import { execFile } from 'child_process';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('../lib/appwrite', () => ({
    databases: {
        getDocument: jest.fn(),
        listDocuments: jest.fn(),
        createDocument: jest.fn(),
        updateDocument: jest.fn(),
    },
    COLLECTIONS: { BUILD_PIPELINES: 'build_pipelines', REPOSITORIES: 'repositories' },
    DB_ID: 'test-db',
    ID: { unique: () => 'deployment-1' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        orderDesc: (field: string) => ({ orderDesc: field }),
        limit: (n: number) => ({ limit: n }),
    },
}));
jest.mock('../services/incidentService', () => ({ createIncident: jest.fn() }));
jest.mock('../services/slackService', () => ({ sendSlackNotification: jest.fn() }));
jest.mock('../services/cosignService', () => ({ verifyImageDigest: jest.fn() }));
jest.mock('../services/securityRequirementsService', () => ({
    securityRequirementsService: { complianceGate: jest.fn().mockResolvedValue({ blocked: false, violations: [] }) },
}));
// mockResolvedValue, not a bare jest.fn(): the signature gate calls
// logSecureAuditEvent(...).catch(...) so an audit-write failure cannot turn a
// clean block into a thrown error, and `.catch` on the `undefined` a bare mock
// returns is a TypeError. The break-glass path only awaits it, which is why a
// bare mock was sufficient before.
jest.mock('../utils/tamperAuditLogger', () => ({ logSecureAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../repositories/gateRunRepository', () => ({ gateRunRepository: { record: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../services/gateService', () => ({ gateService: { stampReleaseVerdict: jest.fn().mockResolvedValue(undefined) } }));

import { databases } from '../lib/appwrite';
import { triggerDeploy } from './deployService';
import { createIncident } from '../services/incidentService';
import { verifyImageDigest } from '../services/cosignService';
import { securityRequirementsService } from '../services/securityRequirementsService';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { gateRunRepository } from '../repositories/gateRunRepository';
import { gateService } from '../services/gateService';

const mockCompliance = securityRequirementsService.complianceGate as jest.Mock;
const mockAudit = logSecureAuditEvent as jest.Mock;
const mockGateRun = gateRunRepository.record as jest.Mock;
const mockStamp = gateService.stampReleaseVerdict as jest.Mock;
const BLOCKED = { blocked: true, violations: [{ projectId: 'pA', code: 'REQ-PCI-6.5.1-SQLI', title: 'Prevent injection', frameworks: ['PCI DSS'], severity: 'high', findingCount: 1, findings: [] }] };

const mockTrivyNoCriticalCves = () => {
    (execFile as unknown as jest.Mock).mockImplementation((cmd: string, ...rest: any[]) => {
        const cb = rest[rest.length - 1];
        if (cmd === 'trivy') {
            return cb(null, { stdout: JSON.stringify({ Results: [] }), stderr: '' });
        }
        return cb(null, { stdout: '', stderr: '' });
    });
};

const mockDeployScaffolding = (buildDoc: Record<string, unknown>) => {
    (databases.getDocument as jest.Mock)
        .mockRejectedValueOnce(new Error('not found in pipeline_runs')) // pipeline_runs lookup fails
        .mockResolvedValueOnce(buildDoc); // falls back to BUILD_PIPELINES
    (databases.listDocuments as jest.Mock)
        .mockResolvedValueOnce({ total: 0, documents: [] }) // deploy_targets
        .mockResolvedValueOnce({ total: 0, documents: [] }); // previous deployments
    (databases.createDocument as jest.Mock).mockResolvedValue({});
    (databases.updateDocument as jest.Mock).mockResolvedValue({});
};

describe('triggerDeploy image signature verification gate', () => {
    beforeEach(() => jest.clearAllMocks());

    it('blocks the deployment when a recorded signature fails verification', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        mockTrivyNoCriticalCves();
        mockDeployScaffolding({ repoId: 'repo-1', imageDigest: 'sha256:abc', imageSignature: 'bad-sig' });
        (verifyImageDigest as jest.Mock).mockResolvedValue(false);

        const result = await triggerDeploy('build-1', 'production', 'tester');

        expect(result.status).toBe('failed');
        expect(result.reason).toBe('Image signature verification failed');
        expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({
            title: expect.stringContaining('signature verification failed'),
            severity: 'CRITICAL',
        }));
        expect(databases.updateDocument).toHaveBeenCalledWith('test-db', 'deployments', 'deployment-1', { status: 'failed' });
    });

    it('does not attempt verification when no signature was recorded on the build', async () => {
        jest.useFakeTimers();
        delete process.env.COSIGN_PUB_KEY_PATH;
        mockTrivyNoCriticalCves();
        mockDeployScaffolding({ repoId: 'repo-1' }); // no imageDigest/imageSignature
        // No deploy target / health check side effects matter here - just confirm
        // verification was never attempted when there's nothing to verify.

        await triggerDeploy('build-1', 'production', 'tester').catch(() => {});

        expect(verifyImageDigest).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});

describe('triggerDeploy compliance gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.COSIGN_PUB_KEY_PATH;
        mockCompliance.mockResolvedValue({ blocked: false, violations: [] });
    });
    afterEach(() => jest.useRealTimers());

    it('hard-blocks a production deploy when a required control is violated', async () => {
        mockTrivyNoCriticalCves();
        mockDeployScaffolding({ repoId: 'repo-1' });
        mockCompliance.mockResolvedValue(BLOCKED);

        const result = await triggerDeploy('build-1', 'production', 'tester');

        expect(result.status).toBe('failed');
        expect(result.reason).toContain('Compliance gate');
        expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({
            title: expect.stringContaining('compliance controls violated'),
            severity: 'CRITICAL',
        }));
        expect(mockAudit).not.toHaveBeenCalled();
        // Ledgered as a deploy-source hard block so it shows in the panel.
        expect(mockGateRun).toHaveBeenCalledWith(expect.objectContaining({
            source: 'deploy', environment: 'production', actor: 'tester', status: 'blocked',
        }));
        // Release-node state stamped BLOCKED so /api/gates/state reflects it.
        expect(mockStamp).toHaveBeenCalledWith('BLOCKED');
    });

    it('proceeds under an audited break-glass override in production', async () => {
        jest.useFakeTimers();
        mockTrivyNoCriticalCves();
        mockDeployScaffolding({ repoId: 'repo-1' });
        mockCompliance.mockResolvedValue(BLOCKED);

        const result = await triggerDeploy('build-1', 'production', 'tester', true);

        expect(result.status).not.toBe('failed');
        expect(mockAudit).toHaveBeenCalledWith('tester', 'BREAK_GLASS_BYPASS', 'repo-1', expect.stringContaining('bypassed'));
        // Ledgered as an overridden deploy — the highest-stakes event to surface.
        expect(mockGateRun).toHaveBeenCalledWith(expect.objectContaining({
            source: 'deploy', environment: 'production', actor: 'tester', status: 'overridden',
        }));
        // Release-node state permanently stamped OVERRIDDEN (not "passing").
        expect(mockStamp).toHaveBeenCalledWith('OVERRIDDEN');
    });

    it('does not block a non-production deploy on a violation (warn only)', async () => {
        jest.useFakeTimers();
        mockTrivyNoCriticalCves();
        mockDeployScaffolding({ repoId: 'repo-1' });
        mockCompliance.mockResolvedValue(BLOCKED);

        const result = await triggerDeploy('build-1', 'dev', 'tester');

        expect(result.status).not.toBe('failed');
        expect(mockAudit).not.toHaveBeenCalled();
        // Non-prod does not touch the release-node state.
        expect(mockStamp).not.toHaveBeenCalled();
    });
});
