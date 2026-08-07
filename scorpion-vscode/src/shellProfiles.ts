/**
 * Native shell profiles for the SCORPION terminal.
 *
 * WHY THIS LIVES IN THE EXTENSION AND NOT IN THE WEB APP:
 * the Scorpion web terminal is a browser SPA served by nginx, and a browser cannot
 * spawn a local process. The only way a "PowerShell" menu entry there could do
 * anything is if the backend container spawned it — which would be arbitrary code
 * execution on the control plane that holds signing keys and gate state, bypassing
 * the verb registry and the audit ledger (see backend/src/services/terminal/commands.ts).
 *
 * The extension host, by contrast, already runs on the operator's own machine with
 * the operator's own privileges. Spawning their shell there adds no capability they
 * did not already have from View > Terminal. That is the whole reason the profiles
 * are here: it is the placement where the feature costs nothing.
 *
 * Deliberately free of any `vscode` import so it can be unit tested under plain Jest —
 * see jest.config.js for why that constraint exists.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ShellProfile {
    /** Must match a `contributes.terminal.profiles[].id` in package.json. */
    id: string;
    name: string;
    /**
     * Tried in order. An entry containing a path separator is checked as an absolute
     * path; a bare executable name is looked up on PATH. First hit wins, so put the
     * preferred build first — `pwsh.exe` before Windows PowerShell 5.1, for instance.
     */
    candidates: readonly string[];
    args?: readonly string[];
}

const isWindows = process.platform === 'win32';

const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
const localAppData = process.env.LOCALAPPDATA;

const windowsProfiles: readonly ShellProfile[] = [
    {
        id: 'scorpion.gitbash',
        name: 'Git Bash',
        // --login -i is what Git for Windows' own shortcut passes; without it the
        // shell starts without /etc/profile and `git` is missing from PATH.
        args: ['--login', '-i'],
        candidates: [
            path.join(programFiles, 'Git', 'bin', 'bash.exe'),
            path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
            ...(localAppData ? [path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe')] : []),
        ],
    },
    {
        id: 'scorpion.powershell',
        name: 'PowerShell',
        candidates: [
            'pwsh.exe',
            path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ],
    },
    {
        id: 'scorpion.cmd',
        name: 'Command Prompt',
        candidates: [process.env.ComSpec ?? path.join(systemRoot, 'System32', 'cmd.exe')],
    },
    {
        id: 'scorpion.bash',
        name: 'Bash (WSL)',
        candidates: [path.join(systemRoot, 'System32', 'wsl.exe')],
    },
];

const posixProfiles: readonly ShellProfile[] = [
    { id: 'scorpion.bash', name: 'Bash', candidates: ['/bin/bash', '/usr/bin/bash', 'bash'] },
    { id: 'scorpion.powershell', name: 'PowerShell', candidates: ['pwsh'] },
];

export const SHELL_PROFILES: readonly ShellProfile[] = isWindows ? windowsProfiles : posixProfiles;

/** Injected in tests; production always uses the real filesystem. */
export type ExistsCheck = (candidate: string) => boolean;

function findOnPath(executable: string, exists: ExistsCheck): string | undefined {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!dir) continue;
        const full = path.join(dir, executable);
        if (exists(full)) return full;
    }
    return undefined;
}

/**
 * Resolves a profile to a concrete executable, or `undefined` when the shell is not
 * installed. `undefined` is a supported answer, not an error — see `shellPathFor`.
 */
export function resolveShellPath(profile: ShellProfile, exists: ExistsCheck = fs.existsSync): string | undefined {
    for (const candidate of profile.candidates) {
        const isAbsoluteish = candidate.includes(path.sep) || candidate.includes('/');
        const found = isAbsoluteish
            ? (exists(candidate) ? candidate : undefined)
            : findOnPath(candidate, exists);
        if (found) return found;
    }
    return undefined;
}

export interface ResolvedProfile {
    name: string;
    /**
     * Absent when the shell was not found. Callers must pass this straight through:
     * VS Code treats an omitted shellPath as "use the user's configured default
     * shell", which is exactly the wanted fallback. Substituting a guess here would
     * turn a missing Git Bash into a silently-wrong shell instead of a working one.
     */
    shellPath?: string;
    shellArgs?: readonly string[];
    /** True when we fell back to the default shell, so the caller can say so. */
    fellBack: boolean;
}

export function shellPathFor(profile: ShellProfile, exists: ExistsCheck = fs.existsSync): ResolvedProfile {
    const shellPath = resolveShellPath(profile, exists);
    return shellPath
        ? { name: profile.name, shellPath, shellArgs: profile.args, fellBack: false }
        : { name: `${profile.name} (default shell)`, fellBack: true };
}
