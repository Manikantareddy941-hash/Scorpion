import { BuildCommandError } from './buildCommandError';
import { errorContext } from '../services/logger';

/**
 * The regression under test is a silent one: the old code rethrew
 * `{ ...error, logs }`, and spreading an Error drops `message` and `stack` because
 * V8 marks them non-enumerable. Nothing failed — the build just reported a JSON blob
 * instead of a reason. So these assert on what survives the throw.
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

    /** This is the property the old plain-object throw did not have. */
    it('survives a spread-and-rethrow losing nothing that matters', () => {
        // What the old code did, shown for contrast: message and stack vanish.
        const spread = { ...raw };
        expect('message' in spread).toBe(false);
        expect('stack' in spread).toBe(false);

        // The replacement keeps them, because it is thrown by reference as an Error.
        expect(build.message).toBeTruthy();
        expect(build.stack).toBeTruthy();
    });

    it('formats through errorContext with both halves of the chain', () => {
        const ctx = errorContext(build);

        expect(ctx.error).toBe('Build step failed');
        // errorContext reduces an Error cause to `${name}: ${message}` so that a
        // cause cannot serialise to `{}` — hence the 'Error: ' prefix here.
        expect(ctx.cause).toBe('Error: Child process exited with code 1');
        expect(ctx.stack).toBeDefined();
    });

    it('omits absent fields rather than emitting undefined', () => {
        const bare = new BuildCommandError('no streams captured', {});

        expect(bare.stdout).toBeUndefined();
        expect(bare.stderr).toBeUndefined();
        expect(bare.logs).toBeUndefined();
        expect('cause' in bare).toBe(false);
        expect(errorContext(bare).cause).toBeUndefined();
    });
});
