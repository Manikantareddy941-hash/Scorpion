import * as path from 'path';
import { resolveShellPath, shellPathFor, SHELL_PROFILES, type ShellProfile } from './shellProfiles';

/**
 * The resolver is the only real logic here — everything else is a table. What has to
 * hold: preference order is honoured, PATH lookup works for bare names, and a shell
 * that is not installed resolves to "use the default shell" rather than to a broken
 * shellPath that VS Code would fail to spawn.
 */

const absolute = (...parts: string[]) => path.join(...parts);

/** Only the listed paths exist. */
const only = (...present: string[]) => (candidate: string) => present.includes(candidate);

describe('resolveShellPath', () => {
    const profile: ShellProfile = {
        id: 'test',
        name: 'Test Shell',
        candidates: [absolute('opt', 'preferred', 'sh'), absolute('opt', 'fallback', 'sh')],
    };

    it('returns the first candidate that exists', () => {
        const found = resolveShellPath(profile, only(absolute('opt', 'preferred', 'sh'), absolute('opt', 'fallback', 'sh')));
        expect(found).toBe(absolute('opt', 'preferred', 'sh'));
    });

    it('skips a missing preferred candidate and takes the next', () => {
        const found = resolveShellPath(profile, only(absolute('opt', 'fallback', 'sh')));
        expect(found).toBe(absolute('opt', 'fallback', 'sh'));
    });

    it('returns undefined when no candidate exists', () => {
        expect(resolveShellPath(profile, () => false)).toBeUndefined();
    });

    it('resolves a bare executable name against PATH', () => {
        const dir = absolute('usr', 'local', 'bin');
        const previous = process.env.PATH;
        process.env.PATH = dir;
        try {
            const bare: ShellProfile = { id: 'test', name: 'Bare', candidates: ['pwsh'] };
            expect(resolveShellPath(bare, only(path.join(dir, 'pwsh')))).toBe(path.join(dir, 'pwsh'));
        } finally {
            process.env.PATH = previous;
        }
    });

    it('does not treat a bare name as a path when it is absent from PATH', () => {
        const previous = process.env.PATH;
        process.env.PATH = '';
        try {
            const bare: ShellProfile = { id: 'test', name: 'Bare', candidates: ['pwsh'] };
            // An exists() that says yes to everything must still not match, because a
            // bare name is never checked as a path — otherwise 'pwsh' would "resolve"
            // to the literal string and VS Code would try to spawn a relative path.
            expect(resolveShellPath(bare, () => true)).toBeUndefined();
        } finally {
            process.env.PATH = previous;
        }
    });
});

describe('shellPathFor', () => {
    const profile: ShellProfile = {
        id: 'test',
        name: 'Git Bash',
        args: ['--login', '-i'],
        candidates: [absolute('git', 'bin', 'bash.exe')],
    };

    it('passes the resolved path and args through', () => {
        const resolved = shellPathFor(profile, only(absolute('git', 'bin', 'bash.exe')));
        expect(resolved).toEqual({
            name: 'Git Bash',
            shellPath: absolute('git', 'bin', 'bash.exe'),
            shellArgs: ['--login', '-i'],
            fellBack: false,
        });
    });

    it('omits shellPath entirely when the shell is not installed', () => {
        const resolved = shellPathFor(profile, () => false);

        // The omission IS the fallback: VS Code spawns the user's default shell.
        // A present-but-wrong shellPath would fail to spawn instead.
        expect(resolved.shellPath).toBeUndefined();
        expect(resolved.shellArgs).toBeUndefined();
        expect(resolved.fellBack).toBe(true);
        expect(resolved.name).toBe('Git Bash (default shell)');
    });
});

describe('SHELL_PROFILES', () => {
    it('declares unique ids', () => {
        const ids = SHELL_PROFILES.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every profile at least one candidate', () => {
        SHELL_PROFILES.forEach((p) => expect(p.candidates.length).toBeGreaterThan(0));
    });
});
