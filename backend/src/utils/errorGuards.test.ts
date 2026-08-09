import { isAppwriteError, isExecError } from './errorGuards';

/**
 * These guards sit in front of control-flow decisions — `code === 409` deciding
 * whether a migration treats an attribute as already-present. A guard that is too
 * loose reintroduces the `any` it replaced; one that is too strict silently sends
 * every migration down the failure branch. Both directions are covered.
 */

describe('isAppwriteError', () => {
    it('accepts a numeric code or a string type', () => {
        expect(isAppwriteError({ code: 409 })).toBe(true);
        expect(isAppwriteError({ type: 'collection_not_found' })).toBe(true);
        expect(isAppwriteError({ code: 404, type: 'document_not_found', message: 'nope' })).toBe(true);
    });

    /** The whole point: a guard that says true for `{}` narrows nothing. */
    it('rejects values carrying neither discriminator', () => {
        expect(isAppwriteError({})).toBe(false);
        expect(isAppwriteError({ message: 'just a message' })).toBe(false);
        expect(isAppwriteError(new Error('boom'))).toBe(false);
    });

    it('rejects a code or type of the wrong primitive type', () => {
        // Appwrite sends a numeric code; a string '409' means this is some other
        // error shape and the === comparisons downstream would silently never match.
        expect(isAppwriteError({ code: '409' })).toBe(false);
        expect(isAppwriteError({ type: 42 })).toBe(false);
    });

    it('rejects non-objects, including null', () => {
        expect(isAppwriteError(null)).toBe(false);
        expect(isAppwriteError(undefined)).toBe(false);
        expect(isAppwriteError('code')).toBe(false);
        expect(isAppwriteError(409)).toBe(false);
    });
});

describe('isExecError', () => {
    it('accepts captured streams and the build transcript', () => {
        expect(isExecError({ stdout: 'out' })).toBe(true);
        expect(isExecError({ stderr: 'err' })).toBe(true);
        expect(isExecError({ logs: 'transcript' })).toBe(true);
    });

    it('rejects a plain error with no streams attached', () => {
        expect(isExecError(new Error('boom'))).toBe(false);
        expect(isExecError({ message: 'boom' })).toBe(false);
        expect(isExecError(null)).toBe(false);
    });

    /**
     * buildService rethrows `{ ...error, logs }`. Spreading an Error keeps its
     * enumerable own properties — the exec streams — so both discriminators can
     * legitimately arrive on the same value.
     */
    it('accepts the rethrown shape carrying both streams and logs', () => {
        expect(isExecError({ stdout: 'o', stderr: 'e', logs: 'l' })).toBe(true);
    });
});
