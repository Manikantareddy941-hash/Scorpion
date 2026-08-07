// Mock execFile (promisified) and fs.promises so runFfuf exercises its
// wordlist check, JSON parse, and temp-file cleanup without a real ffuf.
let mockExecImpl: (cb: (err: unknown, out?: { stdout: string; stderr: string }) => void) => void;

jest.mock('child_process', () => ({
    execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, out?: { stdout: string; stderr: string }) => void) => {
        mockExecImpl(cb);
    },
}));

const mockAccess = jest.fn();
const mockReadFile = jest.fn();
const mockUnlink = jest.fn();
jest.mock('fs', () => ({
    promises: {
        access: (...a: unknown[]) => mockAccess(...a),
        readFile: (...a: unknown[]) => mockReadFile(...a),
        unlink: (...a: unknown[]) => mockUnlink(...a),
    },
}));
jest.mock('./logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('./logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { runFfuf } from './ffufService';

describe('runFfuf', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAccess.mockResolvedValue(undefined);
        mockUnlink.mockResolvedValue(undefined);
        mockExecImpl = (cb) => cb(null, { stdout: '', stderr: '' });
    });

    it('throws a clear error when the wordlist is missing', async () => {
        mockAccess.mockRejectedValue(new Error('ENOENT'));
        await expect(runFfuf('https://x.test')).rejects.toThrow(/wordlist not found/);
    });

    it('parses ffuf results from the output file and cleans it up', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify({
            results: [
                { input: { FUZZ: 'admin' }, status: 200, length: 12, url: 'https://x.test/admin' },
                { input: { FUZZ: 'login' }, status: 301, length: 0, url: 'https://x.test/login' },
            ],
        }));

        const results = await runFfuf('https://x.test/');

        expect(results).toHaveLength(2);
        expect(results[0].input?.FUZZ).toBe('admin');
        // Temp file removed even on the happy path.
        expect(mockUnlink).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array when ffuf reports no results', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify({ results: [] }));
        const results = await runFfuf('https://x.test');
        expect(results).toEqual([]);
    });

    it('throws a timeout error when the process is killed', async () => {
        mockExecImpl = (cb) => cb({ killed: true });
        await expect(runFfuf('https://x.test')).rejects.toThrow(/timed out/);
    });

    it('cleans up the temp file even when parsing the output fails', async () => {
        mockReadFile.mockResolvedValue('not-json');
        await expect(runFfuf('https://x.test')).rejects.toThrow();
        expect(mockUnlink).toHaveBeenCalledTimes(1);
    });
});
