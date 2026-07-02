// triggerPipelineRun fires runPipeline() in the background (fire-and-forget).
// Stub fs/child_process so that background work can't touch the real
// filesystem or spawn real processes while these tests run.
jest.mock('fs/promises', () => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    appendFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
    readdir: jest.fn().mockResolvedValue([]),
    rm: jest.fn().mockResolvedValue(undefined),
    cp: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('child_process', () => ({ execFile: jest.fn((_f, _a, _o, cb) => cb && cb(null, '', '')) }));

jest.mock('../lib/appwrite', () => ({
    databases: {
        getDocument: jest.fn(),
        createDocument: jest.fn(),
        updateDocument: jest.fn(),
        listDocuments: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { REPOSITORIES: 'repositories' },
    ID: { unique: jest.fn(() => 'generated-id') },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        orderDesc: (field: string) => ({ orderDesc: field }),
        limit: (n: number) => ({ limit: n }),
    },
}));
jest.mock('./scanService', () => ({ triggerScan: jest.fn() }));
jest.mock('../routes/gateRoutes', () => ({ checkReleaseGate: jest.fn() }));
jest.mock('../deploy/deployService', () => ({ triggerDeploy: jest.fn() }));
jest.mock('./logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('./dockerRunnerService', () => ({ dockerRunnerService: { runInContainer: jest.fn() } }));
jest.mock('./sshService', () => ({ sshService: { executeDeployment: jest.fn() } }));
jest.mock('./containerizedTrivyService', () => ({ containerizedTrivyService: { runTrivyScan: jest.fn() } }));
jest.mock('./cosignService', () => ({ getImageDigest: jest.fn(), signImageDigest: jest.fn() }));

import { triggerPipelineRun } from './pipelineService';
import { databases } from '../lib/appwrite';

describe('triggerPipelineRun idempotency', () => {
    beforeEach(() => jest.clearAllMocks());

    const mockDb = databases as unknown as {
        getDocument: jest.Mock;
        createDocument: jest.Mock;
        listDocuments: jest.Mock;
    };

    it('reuses an in-flight run for the same repo/branch/commit instead of creating a duplicate', async () => {
        mockDb.getDocument.mockResolvedValue({ $id: 'repo-1', name: 'repo-1' });
        mockDb.listDocuments.mockImplementation((_db: string, collection: string) => {
            if (collection === 'pipelines') return Promise.resolve({ total: 1, documents: [{ $id: 'pipeline-1' }] });
            if (collection === 'pipeline_runs') {
                return Promise.resolve({
                    total: 1,
                    documents: [{ $id: 'existing-run', status: 'running', startedAt: new Date().toISOString() }],
                });
            }
            return Promise.resolve({ total: 0, documents: [] });
        });

        const runId = await triggerPipelineRun('repo-1', 'main', 'abc123', 'msg', 'author');

        expect(runId).toBe('existing-run');
        expect(mockDb.createDocument).not.toHaveBeenCalledWith(
            'test-db', 'pipeline_runs', expect.anything(), expect.anything()
        );
    });

    it('starts a new run when no in-flight run matches the same commit', async () => {
        mockDb.getDocument.mockResolvedValue({ $id: 'repo-1', name: 'repo-1' });
        mockDb.listDocuments.mockImplementation((_db: string, collection: string) => {
            if (collection === 'pipelines') return Promise.resolve({ total: 1, documents: [{ $id: 'pipeline-1' }] });
            if (collection === 'pipeline_runs') return Promise.resolve({ total: 0, documents: [] });
            return Promise.resolve({ total: 0, documents: [] });
        });
        mockDb.createDocument.mockResolvedValue({ $id: 'generated-id' });

        const runId = await triggerPipelineRun('repo-1', 'main', 'abc123', 'msg', 'author');

        expect(runId).toBe('generated-id');
        expect(mockDb.createDocument).toHaveBeenCalledWith(
            'test-db', 'pipeline_runs', 'generated-id', expect.objectContaining({ repoId: 'repo-1', branch: 'main', commitHash: 'abc123' })
        );
    });

    it('does not reuse a run stuck in-flight past the dedupe window', async () => {
        mockDb.getDocument.mockResolvedValue({ $id: 'repo-1', name: 'repo-1' });
        mockDb.listDocuments.mockImplementation((_db: string, collection: string) => {
            if (collection === 'pipelines') return Promise.resolve({ total: 1, documents: [{ $id: 'pipeline-1' }] });
            if (collection === 'pipeline_runs') {
                const staleStart = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
                return Promise.resolve({
                    total: 1,
                    documents: [{ $id: 'stale-run', status: 'running', startedAt: staleStart }],
                });
            }
            return Promise.resolve({ total: 0, documents: [] });
        });
        mockDb.createDocument.mockResolvedValue({ $id: 'generated-id' });

        const runId = await triggerPipelineRun('repo-1', 'main', 'abc123', 'msg', 'author');

        expect(runId).toBe('generated-id');
    });
});
