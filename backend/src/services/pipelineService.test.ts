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

import crypto from 'crypto';
import { triggerPipelineRun } from './pipelineService';
import { databases } from '../lib/appwrite';

// Mirrors the deterministic id derivation in triggerPipelineRun so tests don't
// depend on ID.unique() for commits that go through the atomic dedupe path.
function deterministicRunId(repoId: string, branch: string, commitHash: string) {
    return `run_${crypto.createHash('sha1').update(`${repoId}:${branch}:${commitHash}`).digest('hex').slice(0, 32)}`;
}

function conflictError() {
    const err: any = new Error('Document already exists');
    err.code = 409;
    return err;
}

describe('triggerPipelineRun idempotency', () => {
    beforeEach(() => jest.clearAllMocks());

    const mockDb = databases as unknown as {
        getDocument: jest.Mock;
        createDocument: jest.Mock;
        updateDocument: jest.Mock;
        listDocuments: jest.Mock;
    };

    beforeEach(() => {
        mockDb.listDocuments.mockImplementation((_db: string, collection: string) => {
            if (collection === 'pipelines') return Promise.resolve({ total: 1, documents: [{ $id: 'pipeline-1' }] });
            return Promise.resolve({ total: 0, documents: [] });
        });
    });

    it('reuses an in-flight run for the same repo/branch/commit instead of creating a duplicate', async () => {
        const runId = deterministicRunId('repo-1', 'main', 'abc123');
        mockDb.getDocument.mockImplementation((_db: string, collection: string, id: string) => {
            if (collection === 'repositories') return Promise.resolve({ $id: 'repo-1', name: 'repo-1' });
            if (collection === 'pipeline_runs') return Promise.resolve({ $id: id, status: 'running', startedAt: new Date().toISOString() });
            return Promise.reject(new Error('not found'));
        });
        mockDb.createDocument.mockRejectedValue(conflictError());

        const result = await triggerPipelineRun('repo-1', 'main', 'abc123', 'msg', 'author');

        expect(result).toBe(runId);
        expect(mockDb.updateDocument).not.toHaveBeenCalled();
    });

    it('starts a new run when no run exists yet for this commit', async () => {
        const runId = deterministicRunId('repo-1', 'main', 'abc123');
        mockDb.getDocument.mockImplementation((_db: string, collection: string) => {
            if (collection === 'repositories') return Promise.resolve({ $id: 'repo-1', name: 'repo-1' });
            return Promise.reject(new Error('not found'));
        });
        mockDb.createDocument.mockResolvedValue({ $id: runId });

        const result = await triggerPipelineRun('repo-1', 'main', 'abc123', 'msg', 'author');

        expect(result).toBe(runId);
        expect(mockDb.createDocument).toHaveBeenCalledWith(
            'test-db', 'pipeline_runs', runId,
            expect.objectContaining({ repoId: 'repo-1', branch: 'main', commitHash: 'abc123' })
        );
    });

    it('restarts a run in place when the same commit was retried after the previous attempt went stale', async () => {
        const runId = deterministicRunId('repo-1', 'main', 'abc123');
        const staleStart = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
        mockDb.getDocument.mockImplementation((_db: string, collection: string, id: string) => {
            if (collection === 'repositories') return Promise.resolve({ $id: 'repo-1', name: 'repo-1' });
            if (collection === 'pipeline_runs') return Promise.resolve({ $id: id, status: 'running', startedAt: staleStart });
            return Promise.reject(new Error('not found'));
        });
        mockDb.createDocument.mockRejectedValue(conflictError());
        mockDb.updateDocument.mockResolvedValue({ $id: runId });

        const result = await triggerPipelineRun('repo-1', 'main', 'abc123', 'msg', 'author');

        expect(result).toBe(runId);
        expect(mockDb.updateDocument).toHaveBeenCalledWith(
            'test-db', 'pipeline_runs', runId,
            expect.objectContaining({ status: 'pending', commitHash: 'abc123' })
        );
    });

    it('does not dedupe manual triggers, since each should run independently', async () => {
        mockDb.getDocument.mockImplementation((_db: string, collection: string) => {
            if (collection === 'repositories') return Promise.resolve({ $id: 'repo-1', name: 'repo-1' });
            return Promise.reject(new Error('not found'));
        });
        mockDb.createDocument.mockResolvedValue({ $id: 'generated-id' });

        const runId = await triggerPipelineRun('repo-1', 'main', 'MANUAL', 'msg', 'author');

        expect(runId).toBe('generated-id');
        expect(mockDb.createDocument).toHaveBeenCalledWith(
            'test-db', 'pipeline_runs', 'generated-id', expect.objectContaining({ commitHash: 'MANUAL' })
        );
    });
});
