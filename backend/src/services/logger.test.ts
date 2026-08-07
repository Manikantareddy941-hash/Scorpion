import { errorContext } from './logger';

/**
 * The regression these guard against is invisible at runtime: a log line that
 * looks like it recorded a failure while carrying none of the cause. So the
 * assertions are about which keys are present, not about formatting.
 */

const originalNodeEnv = process.env.NODE_ENV;

/**
 * `new Error(msg, { cause })` is ES2022 and this project compiles against es2016,
 * so the two-argument constructor does not typecheck. The property is set directly
 * — which is what the runtime ends up with either way.
 */
const withCause = (err: Error, cause: unknown): Error => Object.assign(err, { cause });

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
});

describe('errorContext', () => {
    it('extracts the message from an Error', () => {
        expect(errorContext(new Error('boom')).error).toBe('boom');
    });

    it('stringifies a non-Error throw rather than dropping it', () => {
        // `throw 'string'` and `Promise.reject(undefined)` both reach catch blocks
        // in this codebase via third-party libraries.
        expect(errorContext('plain string').error).toBe('plain string');
        expect(errorContext(undefined).error).toBe('undefined');
        expect(errorContext({ code: 'ENOENT' }).error).toBe('[object Object]');
    });

    it('omits cause and stack keys entirely when there is nothing to report', () => {
        process.env.NODE_ENV = 'production';
        const ctx = errorContext(new Error('boom'));

        expect(ctx).toEqual({ error: 'boom' });
        expect('cause' in ctx).toBe(false);
        expect('stack' in ctx).toBe(false);
    });

    describe('cause', () => {
        it('reduces an Error cause to name and message', () => {
            const err = withCause(new Error('outer'), new TypeError('inner'));
            expect(errorContext(err).cause).toBe('TypeError: inner');
        });

        /**
         * The trap this exists for: JSON.stringify(new Error('x')) is '{}' because
         * message and stack are non-enumerable. An un-reduced cause would serialise
         * to an empty object and read as "no cause was recorded".
         */
        it('does not let an Error cause serialise to an empty object', () => {
            const ctx = errorContext(withCause(new Error('outer'), new Error('inner')));
            expect(JSON.stringify(ctx)).toContain('inner');
        });

        it('passes a string cause through and serialises an object cause', () => {
            expect(errorContext(withCause(new Error('o'), 'ECONNRESET')).cause).toBe('ECONNRESET');
            expect(errorContext(withCause(new Error('o'), { code: 502 })).cause).toBe('{"code":502}');
        });

        it('survives a circular cause instead of throwing inside the logger', () => {
            const circular: Record<string, unknown> = {};
            circular.self = circular;

            expect(() => errorContext(withCause(new Error('o'), circular))).not.toThrow();
        });
    });

    describe('stack', () => {
        it('includes the stack outside production', () => {
            process.env.NODE_ENV = 'development';
            expect(errorContext(new Error('boom')).stack).toContain('Error: boom');
        });

        /** Stacks name filesystem paths and internal module layout. */
        it('withholds the stack in production', () => {
            process.env.NODE_ENV = 'production';
            expect(errorContext(new Error('boom')).stack).toBeUndefined();
        });

        it('reads NODE_ENV at call time, not at module load', () => {
            process.env.NODE_ENV = 'production';
            expect(errorContext(new Error('boom')).stack).toBeUndefined();

            process.env.NODE_ENV = 'test';
            expect(errorContext(new Error('boom')).stack).toBeDefined();
        });
    });

    /**
     * The scrub guard. An axios rejection carries `err.config`, which holds the
     * Slack/Discord webhook URL (token in the path) and the OpsGenie
     * `Authorization: GenieKey ...` header. None of it may reach stdout or Loki.
     */
    it('never copies transport properties off the error', () => {
        const axiosLike = Object.assign(new Error('Request failed with status code 401'), {
            config: {
                url: 'https://hooks.slack.com/services/T000/B000/SUPERSECRETTOKEN',
                headers: { Authorization: 'GenieKey 11111111-2222-3333-4444-555555555555' },
            },
            response: { data: { error: 'invalid_token' } },
        });
        process.env.NODE_ENV = 'production';

        const serialised = JSON.stringify(errorContext(axiosLike));

        expect(serialised).not.toContain('SUPERSECRETTOKEN');
        expect(serialised).not.toContain('GenieKey');
        expect(serialised).not.toContain('hooks.slack.com');
        expect(Object.keys(errorContext(axiosLike))).toEqual(['error']);
    });
});
