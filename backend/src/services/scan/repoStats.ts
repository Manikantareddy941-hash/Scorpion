import fs from 'fs';
import path from 'path';

/**
 * Repository statistics gathered by walking the scanned tree.
 *
 * Extracted from scanService so the zero-file guard below can be tested; the
 * scan flow it came from writes to the database and runs six scanners, which
 * makes it impractical to exercise this logic in place.
 */

const EXTENSION_MAP: Readonly<Record<string, string>> = {
    '.java': 'Java', '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.js': 'JavaScript', '.py': 'Python', '.go': 'Go',
    '.cpp': 'C++', '.cs': 'C#',
};

const SKIP_DIRS = new Set(['.git', 'node_modules']);

export interface RepoStats {
    totalFiles: number;
    totalLines: number;
    languageCounts: Record<string, number>;
    detectedLanguage: string;
    /**
     * Paths the walk could not read. Previously these were swallowed by bare
     * `catch {}`, which made an unreadable tree and an empty one produce the
     * same answer: zero files. Callers need to tell those apart.
     */
    unreadable: string[];
}

/**
 * Walks `root`, counting files, lines and languages.
 *
 * Read errors are collected rather than thrown: one unreadable file should not
 * abort a scan whose findings came from the scanners, not from this walk. But
 * they are no longer discarded, because "couldn't read anything" and "there was
 * nothing to read" demand different responses from the caller.
 */
export function collectRepoStats(root: string): RepoStats {
    const languageCounts: Record<string, number> = {};
    const unreadable: string[] = [];
    let totalFiles = 0;
    let totalLines = 0;

    const walk = (dir: string): void => {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            unreadable.push(dir);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            try {
                if (fs.statSync(fullPath).isDirectory()) {
                    if (!SKIP_DIRS.has(entry)) walk(fullPath);
                    continue;
                }
            } catch {
                unreadable.push(fullPath);
                continue;
            }

            totalFiles++;
            const ext = path.extname(entry).toLowerCase();
            const language = EXTENSION_MAP[ext];
            if (language) languageCounts[language] = (languageCounts[language] ?? 0) + 1;

            try {
                totalLines += fs.readFileSync(fullPath, 'utf-8').split('\n').length;
            } catch {
                // Binary or unreadable file: it still counts as a file, we just
                // cannot count its lines. Not a scan-invalidating condition.
                unreadable.push(fullPath);
            }
        }
    };

    walk(root);

    const detectedLanguage =
        Object.entries(languageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown';

    return { totalFiles, totalLines, languageCounts, detectedLanguage, unreadable };
}

/**
 * Thrown when a scan had nothing to examine. Distinct from a scanner failure
 * (ScannerUnavailableError) because the scanners here worked fine — there was
 * simply no input, which makes a "clean" verdict meaningless rather than good.
 */
export class EmptyScanTargetError extends Error {
    constructor(readonly root: string, readonly unreadable: number) {
        super(
            unreadable > 0
                ? `Scan target ${root} yielded no readable files (${unreadable} path(s) could not be read) — refusing to report a clean scan`
                : `Scan target ${root} contains no files — refusing to report a clean scan`,
        );
        this.name = 'EmptyScanTargetError';
    }
}

/**
 * Fail-closed guard: a scan that walked zero files did not find nothing, it
 * examined nothing. Reporting that as clean is the same silent-clean-failure
 * class as a scanner whose empty output was read as a passing verdict.
 *
 * Throws rather than returning a flag because every caller already fails the
 * scan closed on a throw (gate_status: 'failed').
 */
export function assertScanTargetUsable(stats: RepoStats, root: string): void {
    if (stats.totalFiles === 0) {
        throw new EmptyScanTargetError(root, stats.unreadable.length);
    }
}
