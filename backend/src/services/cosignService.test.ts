import { execFile } from 'child_process';

jest.mock('child_process', () => ({
    execFile: jest.fn(),
}));
jest.mock('../utils/toolCheck', () => ({
    resolveToolCommand: jest.fn(),
}));

import { resolveToolCommand } from '../utils/toolCheck';
import {
    isCosignAvailable,
    isSigningConfigured,
    getImageDigest,
    signImageDigest,
    verifyImageDigest,
} from './cosignService';

// execFile is promisified via util.promisify inside cosignService - the
// mock needs to support both the callback form promisify wraps AND expose
// a .custom symbol-free plain callback signature.
const mockExecFile = (impl: (...args: any[]) => void) => {
    (execFile as unknown as jest.Mock).mockImplementation(impl as any);
};

describe('isCosignAvailable / isSigningConfigured', () => {
    const originalEnv = { ...process.env };
    afterEach(() => { process.env = { ...originalEnv }; jest.clearAllMocks(); });

    it('reflects resolveToolCommand status', async () => {
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed' });
        expect(await isCosignAvailable()).toBe(true);

        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'missing' });
        expect(await isCosignAvailable()).toBe(false);
    });

    it('isSigningConfigured reflects COSIGN_KEY_PATH', () => {
        delete process.env.COSIGN_KEY_PATH;
        expect(isSigningConfigured()).toBe(false);
        process.env.COSIGN_KEY_PATH = '/keys/cosign.key';
        expect(isSigningConfigured()).toBe(true);
    });
});

describe('getImageDigest', () => {
    afterEach(() => jest.clearAllMocks());

    it('returns the trimmed docker inspect output', async () => {
        mockExecFile((_cmd, _args, _opts, cb) => cb(null, { stdout: 'sha256:abc123\n', stderr: '' }));

        const digest = await getImageDigest('repo-1:build-1');

        expect(digest).toBe('sha256:abc123');
        expect(execFile).toHaveBeenCalledWith('docker', ['inspect', '--format', '{{.Id}}', 'repo-1:build-1'], expect.anything(), expect.anything());
    });
});

describe('signImageDigest', () => {
    const originalEnv = { ...process.env };
    afterEach(() => { process.env = { ...originalEnv }; jest.clearAllMocks(); });

    it('returns null without calling cosign when no key is configured', async () => {
        delete process.env.COSIGN_KEY_PATH;

        const result = await signImageDigest('sha256:abc');

        expect(result).toBeNull();
        expect(resolveToolCommand).not.toHaveBeenCalled();
    });

    it('returns null when cosign is not installed', async () => {
        process.env.COSIGN_KEY_PATH = '/keys/cosign.key';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'missing' });

        const result = await signImageDigest('sha256:abc');

        expect(result).toBeNull();
    });

    it('signs and returns the base64 signature when configured and installed', async () => {
        process.env.COSIGN_KEY_PATH = '/keys/cosign.key';
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockExecFile((_cmd, _args, _opts, cb) => cb(null, { stdout: 'BASE64SIGNATURE==\n', stderr: '' }));

        const result = await signImageDigest('sha256:abc');

        expect(result).toEqual({ signature: 'BASE64SIGNATURE==', publicKeyPath: '/keys/cosign.pub' });
    });

    it('returns null (not a throw) if the cosign command itself fails', async () => {
        process.env.COSIGN_KEY_PATH = '/keys/cosign.key';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockExecFile((_cmd, _args, _opts, cb) => cb(new Error('signing failed'), null));

        const result = await signImageDigest('sha256:abc');

        expect(result).toBeNull();
    });
});

describe('verifyImageDigest', () => {
    const originalEnv = { ...process.env };
    afterEach(() => { process.env = { ...originalEnv }; jest.clearAllMocks(); });

    it('throws when no public key is configured (could not attempt verification)', async () => {
        delete process.env.COSIGN_PUB_KEY_PATH;

        await expect(verifyImageDigest('sha256:abc', 'sig')).rejects.toThrow('COSIGN_PUB_KEY_PATH');
    });

    it('throws when cosign is not installed', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'missing' });

        await expect(verifyImageDigest('sha256:abc', 'sig')).rejects.toThrow('cosign CLI is not installed');
    });

    it('returns true when verify-blob succeeds', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockExecFile((_cmd, _args, _opts, cb) => cb(null, { stdout: 'Verified OK', stderr: '' }));

        expect(await verifyImageDigest('sha256:abc', 'sig')).toBe(true);
    });

    it('returns false (does not throw) when verify-blob rejects the signature', async () => {
        process.env.COSIGN_PUB_KEY_PATH = '/keys/cosign.pub';
        (resolveToolCommand as jest.Mock).mockResolvedValue({ status: 'installed', cmd: 'cosign', prefixArgs: [] });
        mockExecFile((_cmd, _args, _opts, cb) => cb(new Error('signature mismatch'), null));

        expect(await verifyImageDigest('sha256:abc', 'sig')).toBe(false);
    });
});
