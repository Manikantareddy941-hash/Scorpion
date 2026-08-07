// Mock child_process.execFile so promisify(execFile) resolves/rejects with our
// canned output. execFile is called as execFile(cmd, args, opts, callback).
let mockExecImpl: (cb: (err: unknown, out?: { stdout: string; stderr: string }) => void) => void;

jest.mock('child_process', () => ({
    execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, out?: { stdout: string; stderr: string }) => void) => {
        mockExecImpl(cb);
    },
}));
jest.mock('./logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('./logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { runNuclei } from './nucleiService';

const line = (obj: unknown) => JSON.stringify(obj);

describe('runNuclei', () => {
    afterEach(() => jest.clearAllMocks());

    it('parses multi-line JSONL into result objects', async () => {
        const stdout = [
            line({ 'template-id': 'a', info: { severity: 'high', name: 'A' } }),
            line({ 'template-id': 'b', info: { severity: 'low', name: 'B' } }),
        ].join('\n') + '\n';
        mockExecImpl = (cb) => cb(null, { stdout, stderr: '' });

        const results = await runNuclei('https://x.test');

        expect(results).toHaveLength(2);
        expect(results[0]['template-id']).toBe('a');
        expect(results[1].info?.severity).toBe('low');
    });

    it('skips blank and unparseable lines', async () => {
        const stdout = [
            line({ 'template-id': 'a', info: { name: 'A' } }),
            '',
            'not-json-garbage',
            '   ',
        ].join('\n');
        mockExecImpl = (cb) => cb(null, { stdout, stderr: '' });

        const results = await runNuclei('https://x.test');

        expect(results).toHaveLength(1);
        expect(results[0]['template-id']).toBe('a');
    });

    it('throws a timeout error when the process is killed', async () => {
        mockExecImpl = (cb) => cb({ killed: true, message: 'boom' });

        await expect(runNuclei('https://x.test')).rejects.toThrow(/timed out/);
    });

    it('parses partial stdout when the process errors without being killed', async () => {
        const err = { stdout: line({ 'template-id': 'partial' }) + '\n', killed: false };
        mockExecImpl = (cb) => cb(err);

        const results = await runNuclei('https://x.test');

        expect(results).toHaveLength(1);
        expect(results[0]['template-id']).toBe('partial');
    });

    it('rethrows when the process errors with no stdout', async () => {
        mockExecImpl = (cb) => cb(new Error('nuclei: command not found'));

        await expect(runNuclei('https://x.test')).rejects.toThrow(/command not found/);
    });
});
