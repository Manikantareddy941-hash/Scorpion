import { execFile } from 'child_process';

jest.mock('child_process', () => ({
    execFile: jest.fn(),
}));
jest.mock('../utils/toolCheck', () => ({
    resolveToolCommand: jest.fn(),
}));

import { resolveToolCommand } from '../utils/toolCheck';
import {
    buildProvenanceStatement,
    attestProvenance,
    verifyProvenance,
    BuildContext,
} from './provenanceService';

const mockExecFile = (impl: (...args: any[]) => void) => {
    (execFile as unknown as jest.Mock).mockImplementation(impl as any);
};

const ctx: BuildContext = {
    imageName: 'repo-1:build-1',
    imageDigest: 'sha256:abc123',
    repoUrl: 'https://github.com/acme/app.git',
    branch: 'main',
    commitSha: 'deadbeef',
    invocationId: 'pipeline-42',
    startedOn: '2026-07-03T00:00:00.000Z',
    finishedOn: '2026-07-03T00:01:00.000Z',
};

describe('buildProvenanceStatement', () => {
    it('produces an in-toto v1 statement with SLSA v1 predicate', () => {
        const s = buildProvenanceStatement(ctx);

        expect(s._type).toBe('https://in-toto.io/Statement/v1');
        expect(s.predicateType).toBe('https://slsa.dev/provenance/v1');
        // Subject digest is the bare hex, without the sha256: prefix.
        expect(s.subject).toEqual([{ name: 'repo-1:build-1', digest: { sha256: 'abc123' } }]);
        expect(s.predicate.buildDefinition.externalParameters).toEqual({
            repository: 'https://github.com/acme/app.git',
            branch: 'main',
        });
        expect(s.predicate.buildDefinition.resolvedDependencies).toEqual([
            { uri: 'https://github.com/acme/app.git', digest: { gitCommit: 'deadbeef' } },
        ]);
        expect(s.predicate.runDetails.metadata).toEqual({
            invocationId: 'pipeline-42',
            startedOn: ctx.startedOn,
            finishedOn: ctx.finishedOn,
        });
    });
});

describe('attestProvenance', () => {
    const originalEnv = { ...process.env };
    afterEach(() => { process.env = { ...originalEnv }; jest.clearAllMocks(); });

    it('returns null without calling cosign when no key is configured', async () => {
        delete process.env.COSIGN_KEY_PATH;

        expect(await attestProvenance(ctx)).toBeNull();
        expect(resolveToolCommand).not.toHaveBeenCalled();
    });

    it('returns the statement plus signature when signing is configured', async () => {
        process.env.COSIGN_KEY_PATH = '/keys/cosign.key';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockExecFile((_cmd, _args, _opts, cb) => cb(null, { stdout: 'PROVSIG==\n', stderr: '' }));

        const result = await attestProvenance(ctx);

        expect(result).not.toBeNull();
        expect(result!.signature).toBe('PROVSIG==');
        expect(result!.statement.subject[0].digest.sha256).toBe('abc123');
    });

    // REVERSAL, deliberate. attestProvenance signs through signBlobContent and
    // inherits its contract: null means signing was never configured, a throw
    // means it was configured and failed. Provenance that silently does not
    // exist is provenance nobody notices is missing.
    it('throws if cosign fails', async () => {
        process.env.COSIGN_KEY_PATH = '/keys/cosign.key';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockExecFile((_cmd, _args, _opts, cb) => cb(new Error('boom'), null));

        await expect(attestProvenance(ctx)).rejects.toThrow('cosign sign-blob failed: boom');
    });
});

describe('verifyProvenance', () => {
    const originalEnv = { ...process.env };
    afterEach(() => { process.env = { ...originalEnv }; jest.clearAllMocks(); });

    const statement = buildProvenanceStatement(ctx);

    it('returns false without calling cosign when the statement subject does not match the digest', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';

        const ok = await verifyProvenance('sha256:otherdigest', { statement, signature: 'sig' });

        expect(ok).toBe(false);
        expect(resolveToolCommand).not.toHaveBeenCalled();
    });

    it('throws when no public key is configured (could not attempt verification)', async () => {
        delete process.env.COSIGN_PUB_KEY_PATH;

        await expect(verifyProvenance('sha256:abc123', { statement, signature: 'sig' })).rejects.toThrow('COSIGN_PUB_KEY_PATH');
    });

    it('returns true when the subject matches and verify-blob succeeds', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockExecFile((_cmd, _args, _opts, cb) => cb(null, { stdout: 'Verified OK', stderr: '' }));

        expect(await verifyProvenance('sha256:abc123', { statement, signature: 'sig' })).toBe(true);
    });

    it('returns false when cosign rejects the signature', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockExecFile((_cmd, _args, _opts, cb) => cb(new Error('signature mismatch'), null));

        expect(await verifyProvenance('sha256:abc123', { statement, signature: 'sig' })).toBe(false);
    });
});
