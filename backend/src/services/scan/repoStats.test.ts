import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectRepoStats, assertScanTargetUsable, EmptyScanTargetError } from './repoStats';

/**
 * Real filesystem rather than a mocked fs: the behaviour under test is precisely
 * how the walk reacts to real directory conditions (missing paths, skipped dirs,
 * unreadable entries), which an fs mock would define away.
 */
let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'repostats-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, content = 'x\n') => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
};

describe('collectRepoStats', () => {
    it('counts files and lines', () => {
        write('a.ts', 'one\ntwo\nthree\n');
        write('b.py', 'x\n');

        const s = collectRepoStats(root);
        expect(s.totalFiles).toBe(2);
        expect(s.totalLines).toBeGreaterThan(0);
    });

    it('detects the most common language', () => {
        write('a.ts');
        write('b.ts');
        write('c.py');

        expect(collectRepoStats(root).detectedLanguage).toBe('TypeScript');
    });

    it('reports Unknown when no known extension is present', () => {
        write('README.md');
        expect(collectRepoStats(root).detectedLanguage).toBe('Unknown');
    });

    it('skips .git and node_modules', () => {
        write('src/a.ts');
        write('.git/objects/deadbeef');
        write('node_modules/pkg/index.js');

        const s = collectRepoStats(root);
        expect(s.totalFiles).toBe(1);
        expect(s.languageCounts.JavaScript).toBeUndefined();
    });

    it('recurses into nested directories', () => {
        write('a/b/c/deep.go');
        expect(collectRepoStats(root).totalFiles).toBe(1);
    });

    it('returns zero files for an empty directory, without throwing', () => {
        const s = collectRepoStats(root);
        expect(s.totalFiles).toBe(0);
        expect(s.unreadable).toEqual([]);
    });

    it('records an unreadable root rather than swallowing it', () => {
        const missing = path.join(root, 'does-not-exist');
        const s = collectRepoStats(missing);

        expect(s.totalFiles).toBe(0);
        // The distinction the bare `catch {}` used to destroy: this is not an
        // empty repo, it is a repo we could not read.
        expect(s.unreadable).toContain(missing);
    });
});

describe('assertScanTargetUsable', () => {
    it('passes when files were walked', () => {
        write('a.ts');
        expect(() => assertScanTargetUsable(collectRepoStats(root), root)).not.toThrow();
    });

    it('throws for an empty target, so a clean verdict cannot be reported', () => {
        expect(() => assertScanTargetUsable(collectRepoStats(root), root))
            .toThrow(EmptyScanTargetError);
    });

    it('throws for a missing target and says the paths were unreadable', () => {
        const missing = path.join(root, 'nope');
        expect(() => assertScanTargetUsable(collectRepoStats(missing), missing))
            .toThrow(/could not be read/);
    });

    it('distinguishes an empty target from an unreadable one in the message', () => {
        expect(() => assertScanTargetUsable(collectRepoStats(root), root))
            .toThrow(/contains no files/);
    });

    it('does not throw merely because some paths were unreadable', () => {
        // Partial coverage is a warning, not a scan-invalidating condition.
        write('a.ts');
        const stats = { ...collectRepoStats(root), unreadable: ['/some/unreadable/path'] };
        expect(() => assertScanTargetUsable(stats, root)).not.toThrow();
    });
});
