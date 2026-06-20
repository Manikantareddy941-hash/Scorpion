import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    installPreCommitHook,
    uninstallPreCommitHook,
    isPreCommitHookInstalled,
    isGitRepo,
} from './preCommitHook';

const makeTempRepo = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-vscode-test-'));
    fs.mkdirSync(path.join(dir, '.git'));
    return dir;
};

describe('preCommitHook', () => {
    let repo: string;

    beforeEach(() => {
        repo = makeTempRepo();
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('isGitRepo is false for a directory with no .git', () => {
        const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-not-a-repo-'));
        expect(isGitRepo(nonRepo)).toBe(false);
        fs.rmSync(nonRepo, { recursive: true, force: true });
    });

    it('refuses to install in a non-git directory', () => {
        const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-not-a-repo-'));
        const result = installPreCommitHook(nonRepo);
        expect(result.installed).toBe(false);
        expect(result.reason).toMatch(/not a git repository/i);
        fs.rmSync(nonRepo, { recursive: true, force: true });
    });

    it('installs the hook and marks it as installed', () => {
        const result = installPreCommitHook(repo);
        expect(result.installed).toBe(true);
        expect(isPreCommitHookInstalled(repo)).toBe(true);

        const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
        const contents = fs.readFileSync(hookPath, 'utf8');
        expect(contents).toContain('gitleaks protect --staged');
    });

    // Windows/NTFS doesn't track POSIX permission bits, so this is only
    // meaningful (and only run) on POSIX platforms - which is also where the
    // hook's executable bit actually matters for git to run it directly.
    (process.platform === 'win32' ? it.skip : it)('makes the hook executable', () => {
        installPreCommitHook(repo);
        const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
        const mode = fs.statSync(hookPath).mode & 0o777;
        expect(mode & 0o100).toBeTruthy(); // owner-executable bit set
    });

    it('does not overwrite a pre-existing hook installed by something else', () => {
        const hooksDir = path.join(repo, '.git', 'hooks');
        fs.mkdirSync(hooksDir, { recursive: true });
        fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\necho "husky hook"\n');

        const result = installPreCommitHook(repo);
        expect(result.installed).toBe(false);
        expect(result.reason).toMatch(/already exists/i);
        expect(fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf8')).toContain('husky hook');
    });

    it('uninstalls a hook it installed', () => {
        installPreCommitHook(repo);
        const result = uninstallPreCommitHook(repo);
        expect(result.uninstalled).toBe(true);
        expect(isPreCommitHookInstalled(repo)).toBe(false);
    });

    it('refuses to uninstall a hook it did not install', () => {
        const hooksDir = path.join(repo, '.git', 'hooks');
        fs.mkdirSync(hooksDir, { recursive: true });
        fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\necho "husky hook"\n');

        const result = uninstallPreCommitHook(repo);
        expect(result.uninstalled).toBe(false);
        expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    });

    it('reports not installed when there is no hook at all', () => {
        expect(isPreCommitHookInstalled(repo)).toBe(false);
        const result = uninstallPreCommitHook(repo);
        expect(result.uninstalled).toBe(false);
        expect(result.reason).toMatch(/no pre-commit hook/i);
    });
});
