/**
 * Terminal profiles offered by the toolbar selector.
 *
 * READ THIS BEFORE ADDING A PROFILE THAT "JUST RUNS IT HERE":
 * this is a browser tab. It cannot spawn a process. The only party that could run
 * PowerShell on behalf of this page is the backend container — and that backend is
 * the control plane holding signing keys and gate state, whose terminal route
 * deliberately has no path from user input to execution
 * (backend/src/services/terminal/commands.ts). Adding a PTY endpoint there to make
 * this dropdown feel native would trade the entire security model for a menu item.
 *
 * So the split is: the audited profile runs here, through the verb registry and the
 * hash-chained ledger. Native profiles are handed to the SCORPION VS Code extension,
 * which already runs on the operator's own machine with their own privileges and
 * therefore grants no capability they did not have from View > Terminal.
 */

export interface ShellProfile {
    id: string;
    label: string;
    description: string;
    /**
     * Where the shell actually runs. 'audited' opens another pane against
     * /api/terminal/exec; 'vscode' deep-links to the extension.
     */
    host: 'audited' | 'vscode';
    /** Windows-only profiles are still listed elsewhere, just marked as such. */
    windowsOnly?: boolean;
}

export const SCORPION_PROFILE_ID = 'scorpion';

export const SHELL_PROFILES: readonly ShellProfile[] = [
    {
        id: SCORPION_PROFILE_ID,
        label: 'Scorpion Audited Shell',
        description: 'Fixed verb registry. Every command is written to the tamper-evident ledger.',
        host: 'audited',
    },
    {
        id: 'scorpion.gitbash',
        label: 'Git Bash',
        description: 'Native shell, opened in VS Code. Not audited.',
        host: 'vscode',
        windowsOnly: true,
    },
    {
        id: 'scorpion.powershell',
        label: 'PowerShell',
        description: 'Native shell, opened in VS Code. Not audited.',
        host: 'vscode',
    },
    {
        id: 'scorpion.cmd',
        label: 'Command Prompt',
        description: 'Native shell, opened in VS Code. Not audited.',
        host: 'vscode',
        windowsOnly: true,
    },
    {
        id: 'scorpion.bash',
        label: 'Bash / WSL',
        description: 'Native shell, opened in VS Code. Not audited.',
        host: 'vscode',
    },
];

/** Must match `publisher` + `name` in scorpion-vscode/package.json. */
const EXTENSION_URI_AUTHORITY = 'scorpion.scorpion-security';

export function vscodeTerminalUri(profileId: string): string {
    return `vscode://${EXTENSION_URI_AUTHORITY}/terminal?profile=${encodeURIComponent(profileId)}`;
}

export function findProfile(id: string): ShellProfile | undefined {
    return SHELL_PROFILES.find((p) => p.id === id);
}
