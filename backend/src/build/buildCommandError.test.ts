import { BuildCommandError, attachedLogs } from './buildCommandError';
import { errorContext } from '../services/logger';

/**
 * The regression under test is a silent one: the old code rethrew
 * `{ ...error, logs }`, and spreading an Error drops `message` and `stack` because
 * V8 marks them non-enumerable. Nothing threw, nothing failed — the build just
 * reported a JSON blob instead of a reason. So these assert on what survives.
 */

describe('BuildCommandError', () => {
    const raw = new Error('Child process exited with code 1');
    const build = new BuildCommandError('Build step failed', {
        stdout: 'Compiling project...',
        stderr: 'SyntaxError: Unexpected token',
        logs: '[ERROR] Build failed at step 2',
        cause: raw,
    });

    it('carries the streams, the transcript and the cause', () => {
        expect(build.name).toBe('BuildCommandError');
        expect(build.message).toBe('Build step failed');
        expect(build.stdout).toBe('Compiling project...');
        expect(build.stderr).toBe('SyntaxError: Unexpected token');
        expect(build.logs).toBe('[ERROR] Build failed at step 2');
        expect((build as Error & { cause?: unknown }).cause).toBe(raw);
    });

    it('is a real Error, so instanceof and stack both work', () => {
        expect(build).toBeInstanceOf(Error);
        expect(build).toBeInstanceOf(BuildCommandError);
        expect(build.stack).toContain('BuildCommandError');
    });

    /** The property the old plain-object rethrow did not have. */
    it('keeps what a spread would have discarded', () => {
        // What the old code did, shown for contrast: both vanish.
        const spread = { ...raw };
        expect('message' in spread).toBe(false);
        expect('stack' in spread).toBe(false);

        expect(build.message).toBeTruthy();
        expect(build.stack).toBeTruthy();
    });

    it('formats through errorContext with both halves of the chain', () => {
        const ctx = errorContext(build);

        expect(ctx.error).toBe('Build step failed');
        // errorContext reduces an Error cause to `${name}: ${message}` so a cause
        // cannot serialise to `{}` — hence the 'Error: ' prefix.
        expect(ctx.cause).toBe('Error: Child process exited with code 1');
        expect(ctx.stack).toBeDefined();
    });

    it('omits absent fields rather than emitting undefined keys', () => {
        const bare = new BuildCommandError('no streams captured');

        expect(bare.stdout).toBeUndefined();
        expect(bare.stderr).toBeUndefined();
        expect(bare.logs).toBeUndefined();
        expect('cause' in bare).toBe(false);
        expect(errorContext(bare).cause).toBeUndefined();
    });
});

describe('attachedLogs', () => {
    it('reads the transcript off a BuildCommandError', () => {
        const err = new BuildCommandError('failed', { logs: 'transcript' });
        expect(attachedLogs(err)).toBe('transcript');
    });

    /**
     * The reason this is structural rather than `instanceof BuildCommandError`.
     * buildService's signing path rethrows `Object.assign(signErr, { logs })` on a
     * CosignSigningError; an instanceof check would silently drop that transcript.
     */
    it('reads the transcript off any Error that had one assigned onto it', () => {
        const signErr = Object.assign(new Error('cosign sign-blob failed'), {
            logs: 'Image signing failed: bad key\n',
        });
        expect(attachedLogs(signErr)).toBe('Image signing failed: bad key\n');
    });

    it('returns undefined for an Error with no transcript, and for non-Errors', () => {
        expect(attachedLogs(new Error('plain'))).toBeUndefined();
        expect(attachedLogs({ logs: 'not an Error' })).toBeUndefined();
        expect(attachedLogs('string')).toBeUndefined();
        expect(attachedLogs(undefined)).toBeUndefined();
    });

    it('ignores a non-string logs property rather than returning it', () => {
        const weird = Object.assign(new Error('x'), { logs: { not: 'a string' } });
        expect(attachedLogs(weird)).toBeUndefined();
    });
});
