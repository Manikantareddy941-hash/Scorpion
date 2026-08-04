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
// CosignSigningError must be a real class in the mock: pipelineService does an
// `instanceof` against it to decide whether a signing failure fails the run, and
// `instanceof undefined` is a TypeError, not a false.
jest.mock('./cosignService', () => ({
  getImageDigest: jest.fn(),
  signImageDigest: jest.fn(),
  CosignSigningError: class CosignSigningError extends Error {},
}));

import crypto from 'crypto';
import { Response } from 'express';
import {
    triggerPipelineRun, runPipeline, registerSseClient, unregisterSseClient,
    notifyStageChange, PipelineLogger,
} from './pipelineService';
import { databases } from '../lib/appwrite';
import { checkReleaseGate } from '../routes/gateRoutes';
import { triggerDeploy } from '../deploy/deployService';
import { dockerRunnerService } from './dockerRunnerService';
import { sshService } from './sshService';
import { containerizedTrivyService } from './containerizedTrivyService';
import { getImageDigest, signImageDigest } from './cosignService';

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

// --- runPipeline stage machine -------------------------------------------

const db = databases as unknown as {
    getDocument: jest.Mock;
    createDocument: jest.Mock;
    updateDocument: jest.Mock;
    listDocuments: jest.Mock;
};
const fsMock = jest.requireMock('fs/promises') as { readdir: jest.Mock; appendFile: jest.Mock };
const gate = checkReleaseGate as jest.Mock;
const deployMock = triggerDeploy as jest.Mock;
const runInContainer = dockerRunnerService.runInContainer as jest.Mock;
const sshDeploy = sshService.executeDeployment as jest.Mock;
const trivy = containerizedTrivyService.runTrivyScan as jest.Mock;

const RUN_ID = 'run-stage-1';
const stageRunDoc = (overrides: Record<string, unknown> = {}) => ({
    $id: RUN_ID,
    repoId: 'repo-1',
    repoName: 'My Repo',
    branch: 'main',
    currentStage: 'trigger',
    ...overrides,
});

/** Wires the happy path; individual tests override single mocks to fail a stage. */
const armHappyPath = (repo: Record<string, unknown> = { url: 'https://github.com/a/b.git', name: 'b' }) => {
    db.getDocument.mockImplementation(async (_d: string, col: string) => {
        if (col === 'pipeline_runs') return stageRunDoc();
        if (col === 'repositories') return repo;
        throw new Error(`unexpected getDocument ${col}`);
    });
    db.updateDocument.mockResolvedValue({});
    db.createDocument.mockResolvedValue({ $id: 'created' });
    db.listDocuments.mockResolvedValue({ total: 0, documents: [] });
    fsMock.readdir.mockResolvedValue(['package.json']);
    runInContainer.mockResolvedValue({ exitCode: 0 });
    trivy.mockResolvedValue(0);
    gate.mockResolvedValue({ allowed: true, score: 95, blocker_count: 0, blockers: [] });
    deployMock.mockResolvedValue({ status: 'success', deploymentId: 'dep-1' });
};

const envDocuments = {
    total: 1,
    documents: [{ $id: 'env-1', name: 'production', host: 'h', port: '22', username: 'u', privateKey: 'k', deployPath: '/srv' }],
};

const lastRunUpdate = () =>
    db.updateDocument.mock.calls.filter((c: unknown[]) => c[1] === 'pipeline_runs').at(-1)?.[3] as Record<string, unknown>;

describe('runPipeline stage machine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        armHappyPath();
    });

    it('runs an npm repo through every stage to success', async () => {
        await runPipeline(RUN_ID);

        expect(runInContainer).toHaveBeenCalledTimes(2); // build + test
        expect(gate).toHaveBeenCalledWith('repo-1');
        expect(deployMock).toHaveBeenCalledWith(RUN_ID, 'dev', 'pipeline-runner');
        expect(lastRunUpdate()).toMatchObject({ status: 'success', currentStage: 'completed' });
    });

    it('marks the run failed when the release gate blocks', async () => {
        gate.mockResolvedValue({
            allowed: false, score: 20, blocker_count: 1,
            blockers: [{ severity: 'critical', title: 'RCE' }],
        });

        await runPipeline(RUN_ID);

        expect(deployMock).not.toHaveBeenCalled();
        expect(lastRunUpdate()).toMatchObject({ status: 'failed' });
    });

    it('fails the run when the build container exits non-zero', async () => {
        runInContainer.mockResolvedValue({ exitCode: 1 });

        await runPipeline(RUN_ID);

        expect(lastRunUpdate()).toMatchObject({ status: 'failed' });
    });

    it('builds docker repos and stores the signed image digest', async () => {
        fsMock.readdir.mockResolvedValue(['Dockerfile']);
        (getImageDigest as jest.Mock).mockResolvedValue('sha256:abc');
        (signImageDigest as jest.Mock).mockResolvedValue({ signature: 'sig-1' });

        await runPipeline(RUN_ID);

        const digestUpdate = db.updateDocument.mock.calls.find(
            (c: unknown[]) => (c[3] as Record<string, unknown>)?.imageDigest
        );
        expect(digestUpdate?.[3]).toMatchObject({ imageDigest: 'sha256:abc', imageSignature: 'sig-1' });
        expect(lastRunUpdate()).toMatchObject({ status: 'success' });
    });

    it('continues when image signing is not configured', async () => {
        fsMock.readdir.mockResolvedValue(['Dockerfile']);
        (getImageDigest as jest.Mock).mockResolvedValue('sha256:abc');
        (signImageDigest as jest.Mock).mockResolvedValue(null);

        await runPipeline(RUN_ID);

        expect(lastRunUpdate()).toMatchObject({ status: 'success' });
    });

    it('survives a security-scan fault and still completes', async () => {
        trivy.mockRejectedValue(new Error('trivy image pull failed'));

        await runPipeline(RUN_ID);

        expect(lastRunUpdate()).toMatchObject({ status: 'success' });
    });

    it('deploys over SSH when a target environment exists', async () => {
        db.listDocuments.mockResolvedValue(envDocuments);
        sshDeploy.mockResolvedValue({ success: true });

        await runPipeline(RUN_ID);

        expect(sshDeploy).toHaveBeenCalled();
        expect(deployMock).not.toHaveBeenCalled();
        expect(lastRunUpdate()).toMatchObject({ status: 'success' });
    });

    it('fails the run when the SSH deployment fails', async () => {
        db.listDocuments.mockResolvedValue(envDocuments);
        sshDeploy.mockResolvedValue({ success: false });

        await runPipeline(RUN_ID);

        expect(lastRunUpdate()).toMatchObject({ status: 'failed' });
    });

    it('sanitizes caller-supplied repo names before they reach the remote shell', async () => {
        db.getDocument.mockImplementation(async (_d: string, col: string) => {
            if (col === 'pipeline_runs') return stageRunDoc({ repoName: 'evil; rm -rf / #' });
            return { url: 'https://github.com/a/b.git' };
        });
        db.listDocuments.mockResolvedValue(envDocuments);
        sshDeploy.mockResolvedValue({ success: true });

        await runPipeline(RUN_ID);

        const commands: string[] = sshDeploy.mock.calls[0][0].commands;
        for (const cmd of commands) {
            expect(cmd).not.toMatch(/[;#]|rm -rf \//);
        }
    });

    it('copies uploaded repos from local_path instead of cloning', async () => {
        armHappyPath({ url: 'upload://zip', name: 'b', local_path: '/tmp/extract-1' });
        await runPipeline(RUN_ID);
        expect(lastRunUpdate()).toMatchObject({ status: 'success' });
    });

    it('fails an uploaded repo without a local_path', async () => {
        armHappyPath({ url: 'upload://zip', name: 'b' });
        await runPipeline(RUN_ID);
        expect(lastRunUpdate()).toMatchObject({ status: 'failed' });
    });

    it('skips build and test containers for unknown build tools', async () => {
        fsMock.readdir.mockResolvedValue(['README.md']);

        await runPipeline(RUN_ID);

        expect(runInContainer).not.toHaveBeenCalled();
        expect(lastRunUpdate()).toMatchObject({ status: 'success' });
    });

    // Previously this asserted that a missing repo was replaced by a minimal
    // document stamped user_id:'system' — i.e. it pinned the defect as the
    // contract. Runs are authorized through their repository
    // (canAccessRun -> canAccessResource), so a 'system'-owned repo denied
    // everyone, including whoever triggered the run; the run executed and its
    // results were unreachable. runPipeline has no owner context to use
    // (pipeline_runs carries no owner field), so the correct behaviour is to
    // fail the run rather than fabricate one.
    it('fails the run when the repository is gone, without fabricating one', async () => {
        db.getDocument.mockImplementation(async (_d: string, col: string) => {
            if (col === 'pipeline_runs') return stageRunDoc({ cloneUrl: 'https://github.com/a/b.git' });
            throw new Error('repo missing');
        });

        await runPipeline(RUN_ID);

        const repoCreates = db.createDocument.mock.calls.filter((c: unknown[]) => c[1] === 'repositories');
        expect(repoCreates).toHaveLength(0);
        expect(db.updateDocument).toHaveBeenCalledWith(
            'test-db', 'pipeline_runs', RUN_ID, expect.objectContaining({ status: 'failed' })
        );
    });
});

describe('SSE fanout', () => {
    const fakeRes = () => ({ write: jest.fn() }) as unknown as Response;

    it('notifies registered clients and drops unregistered ones', () => {
        const a = fakeRes();
        const b = fakeRes();
        registerSseClient('sse-run', a);
        registerSseClient('sse-run', b);

        notifyStageChange('sse-run', { stage: 'build', status: 'running' });
        expect(a.write as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('"stage":"build"'));

        unregisterSseClient('sse-run', a);
        notifyStageChange('sse-run', { stage: 'test', status: 'running' });
        expect(a.write as jest.Mock).toHaveBeenCalledTimes(1);
        expect(b.write as jest.Mock).toHaveBeenCalledTimes(2);
    });

    it('swallows write failures from disconnected clients', () => {
        const dead = { write: jest.fn(() => { throw new Error('EPIPE'); }) } as unknown as Response;
        registerSseClient('sse-dead', dead);
        expect(() => notifyStageChange('sse-dead', { stage: 'x' })).not.toThrow();
    });

    it('is a no-op for runs with no clients', () => {
        expect(() => notifyStageChange('nobody-listening', { stage: 'x' })).not.toThrow();
    });
});

describe('PipelineLogger', () => {
    it('formats error entries with stack detail', async () => {
        const pl = new PipelineLogger('err-run');
        await pl.error('stage exploded', new Error('kaboom'));
        expect(fsMock.appendFile.mock.calls.at(-1)?.[1]).toContain('kaboom');
    });
});
