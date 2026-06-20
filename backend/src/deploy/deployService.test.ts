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

import { databases } from '../lib/appwrite';
import { triggerDeploy } from './deployService';
import { createIncident } from '../services/incidentService';
import { verifyImageDigest } from '../services/cosignService';

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
