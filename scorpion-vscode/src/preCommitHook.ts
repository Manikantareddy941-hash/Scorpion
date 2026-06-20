import * as fs from 'fs';
import * as path from 'path';

const HOOK_MARKER = '# scorpion-pre-commit-hook';

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Installed by the SCORPION Security VS Code extension.
# Blocks the commit if gitleaks finds a secret in staged changes.
# Uninstall via "SCORPION: Uninstall Pre-Commit Hook" or delete this file.

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[SCORPION] gitleaks not found on PATH - skipping secret scan." >&2
  exit 0
fi

gitleaks protect --staged --redact -v
if [ $? -ne 0 ]; then
  echo "[SCORPION] Commit blocked: potential secret(s) detected in staged changes." >&2
  echo "[SCORPION] Review the findings above. If this is a false positive, use 'git commit --no-verify'." >&2
  exit 1
fi
`;

const hookPath = (workspaceRoot: string): string => path.join(workspaceRoot, '.git', 'hooks', 'pre-commit');

export function isGitRepo(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, '.git'));
}

export function isPreCommitHookInstalled(workspaceRoot: string): boolean {
  const target = hookPath(workspaceRoot);
  if (!fs.existsSync(target)) {
    return false;
  }
  return fs.readFileSync(target, 'utf8').includes(HOOK_MARKER);
}

/**
 * Installs a pre-commit hook that runs `gitleaks protect --staged` before
 * every commit. Refuses to overwrite a pre-existing hook that wasn't
 * installed by this extension (e.g. husky, a custom script) - the caller
 * should surface that to the user rather than silently clobbering it.
 */
export function installPreCommitHook(workspaceRoot: string): { installed: boolean; reason?: string } {
  if (!isGitRepo(workspaceRoot)) {
    return { installed: false, reason: 'Not a git repository.' };
  }

  const target = hookPath(workspaceRoot);
  if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(HOOK_MARKER)) {
    return { installed: false, reason: 'A pre-commit hook already exists and was not installed by SCORPION. Remove or back it up first.' };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, HOOK_SCRIPT, { mode: 0o755 });
  return { installed: true };
}

export function uninstallPreCommitHook(workspaceRoot: string): { uninstalled: boolean; reason?: string } {
  const target = hookPath(workspaceRoot);
  if (!fs.existsSync(target)) {
    return { uninstalled: false, reason: 'No pre-commit hook is installed.' };
  }
  if (!fs.readFileSync(target, 'utf8').includes(HOOK_MARKER)) {
    return { uninstalled: false, reason: 'The installed pre-commit hook was not installed by SCORPION - leaving it in place.' };
  }
  fs.unlinkSync(target);
  return { uninstalled: true };
}
