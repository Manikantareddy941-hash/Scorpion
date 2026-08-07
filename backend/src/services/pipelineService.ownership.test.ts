// Pipeline runs are authorized through their repository: pipelineRoutes'
// canAccessRun loads run.repoId and calls canAccessResource(repo, userId).
// The placeholder repos this service created were stamped user_id:'system',
// which belongs to no tenant — so canAccessResource denied EVERYONE, including
// the user who triggered the run. The run executed and its results were
// unreachable: dark data.
jest.mock('fs/promises', () => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    appendFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
    readdir: jest.fn().mockResolvedValue([]),
    rm: jest.fn().mockResolvedValue(undefined),
    cp: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('child_process', () => ({ execFile: jest.fn((_f: unknown, _a: unknown, _o: unknown, cb: (e: unknown, o: string, s: string) => void) => cb && cb(null, '', '')) }));
jest.mock('../lib/appwrite', () => ({
    databases: { getDocument: jest.fn(), createDocument: jest.fn(), updateDocument: jest.fn(), listDocuments: jest.fn() },
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
jest.mock('./logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('./logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('./dockerRunnerService', () => ({ dockerRunnerService: { runInContainer: jest.fn() } }));
jest.mock('./sshService', () => ({ sshService: { executeDeployment: jest.fn() } }));
jest.mock('./containerizedTrivyService', () => ({ containerizedTrivyService: { runTrivyScan: jest.fn() } }));
// Real class, not a jest.fn: pipelineService does `instanceof CosignSigningError`
// on the signing failure path, and `instanceof undefined` throws a TypeError.
jest.mock('./cosignService', () => ({
  getImageDigest: jest.fn(),
  signImageDigest: jest.fn(),
  CosignSigningError: class CosignSigningError extends Error {},
}));

import { triggerPipelineRun, runPipeline } from './pipelineService';
import { databases } from '../lib/appwrite';

const db = databases as unknown as {
    getDocument: jest.Mock; createDocument: jest.Mock; updateDocument: jest.Mock; listDocuments: jest.Mock;
};

const missing = () => Promise.reject(new Error('document not found'));

beforeEach(() => {
    db.getDocument.mockReset();
    db.createDocument.mockReset().mockResolvedValue({ $id: 'created' });
    db.updateDocument.mockReset().mockResolvedValue({});
    db.listDocuments.mockReset().mockResolvedValue({ total: 0, documents: [] });
});

const repoCreates = () =>
    db.createDocument.mock.calls.filter((c) => c[1] === 'repositories');

describe('triggerPipelineRun', () => {
    test('stamps the triggering user on a placeholder repo, never "system"', async () => {
        db.getDocument.mockImplementation(missing); // repo absent

        await triggerPipelineRun('repo-1', 'main', 'MANUAL', 'msg', 'author', 'Repo', 'https://x/y.git', 'user-7');

        const created = repoCreates();
        expect(created).toHaveLength(1);
        expect(created[0][3]).toMatchObject({ user_id: 'user-7' });
        expect(created[0][3].user_id).not.toBe('system');
    });

    test('refuses to create an unowned repo when no owner is supplied', async () => {
        db.getDocument.mockImplementation(missing);

        await expect(
            triggerPipelineRun('repo-1', 'main', 'MANUAL', 'msg', 'author', 'Repo', 'https://x/y.git'),
        ).rejects.toThrow(/owner/i);

        // Fabricating an unowned row is the failure mode being removed.
        expect(repoCreates()).toHaveLength(0);
    });

    test('an existing repo is left alone regardless of the owner argument', async () => {
        db.getDocument.mockResolvedValue({ $id: 'repo-1', name: 'Repo', url: 'https://x/y', user_id: 'someone' });

        await triggerPipelineRun('repo-1', 'main', 'MANUAL', 'msg', 'author', undefined, undefined, 'user-7');

        expect(repoCreates()).toHaveLength(0);
    });
});

describe('runPipeline', () => {
    test('fails the run instead of fabricating an unowned repo when the repo is gone', async () => {
        db.getDocument.mockImplementation((_db: string, collection: string) =>
            collection === 'pipeline_runs'
                ? Promise.resolve({ $id: 'run-1', repoId: 'repo-gone', repoName: 'Repo' })
                : missing(),
        );

        await runPipeline('run-1');

        // No owner context exists at execution time, so inventing one would
        // recreate the dark-data path this change removes.
        expect(repoCreates()).toHaveLength(0);
        const failed = db.updateDocument.mock.calls.find(
            (c) => c[1] === 'pipeline_runs' && c[3]?.status === 'failed',
        );
        expect(failed).toBeTruthy();
    });
});
