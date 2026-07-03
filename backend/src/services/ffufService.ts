import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

// Wall-clock cap so a hung ffuf can't wedge the worker. Override with FFUF_TIMEOUT_MS.
const FFUF_TIMEOUT_MS = Number(process.env.FFUF_TIMEOUT_MS) || 10 * 60 * 1000;
// Requests/sec ceiling. A fuzzer hammering shared staging is a self-inflicted
// DoS otherwise. Override with FFUF_RATE.
const DEFAULT_RATE = Number(process.env.FFUF_RATE) || 40;

// ponytail: cwd-based resolution — the repo's `start` script and Jest both run
// from backend/, so cwd is stable here. tsc doesn't copy assets/ into dist, so
// __dirname would point into dist/ and miss the file. Override with FFUF_WORDLIST.
const defaultWordlist = () =>
    process.env.FFUF_WORDLIST || path.resolve(process.cwd(), 'assets', 'ffuf-common.txt');

export interface FfufResult {
    input?: { FUZZ?: string };
    status?: number;
    length?: number;
    words?: number;
    lines?: number;
    url?: string;
    'content-type'?: string;
}

/**
 * Content-discovery fuzz: requests <targetUrl>/FUZZ for each wordlist entry and
 * returns the responses ffuf considered hits. ffuf exits 0 on success and
 * writes JSON to a file (no stdout JSON), so we use a temp file and clean it up.
 */
export const runFfuf = async (
    targetUrl: string,
    opts: { wordlistPath?: string; rate?: number } = {}
): Promise<FfufResult[]> => {
    const wordlist = opts.wordlistPath || defaultWordlist();

    // Fail fast with a clear message if the wordlist is missing, rather than
    // letting ffuf emit a cryptic error.
    try {
        await fs.access(wordlist);
    } catch {
        throw new Error(`ffuf wordlist not found at ${wordlist}`);
    }

    const fuzzUrl = `${targetUrl.replace(/\/$/, '')}/FUZZ`;
    const outFile = path.join(os.tmpdir(), `ffuf-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const rate = String(opts.rate ?? DEFAULT_RATE);

    const args = [
        '-u', fuzzUrl,
        '-w', wordlist,
        '-of', 'json',
        '-o', outFile,
        '-rate', rate,
        '-s', // silent: no progress bar to stderr
    ];

    logger.info(`[ffuf] Fuzzing ${fuzzUrl} (rate ${rate}/s)`);

    try {
        await execFileAsync('ffuf', args, { timeout: FFUF_TIMEOUT_MS });
    } catch (error: unknown) {
        const e = error as { killed?: boolean };
        if (e.killed) {
            throw new Error(`ffuf timed out after ${FFUF_TIMEOUT_MS}ms`);
        }
        // ffuf exits 0 on a clean run; a throw here is a real failure (binary
        // missing, bad args). Unlike nuclei we do NOT salvage partial output —
        // an errored ffuf file may be truncated/absent.
        throw error;
    }

    try {
        const raw = await fs.readFile(outFile, 'utf-8');
        const parsed = JSON.parse(raw) as { results?: FfufResult[] };
        return parsed.results ?? [];
    } finally {
        await fs.unlink(outFile).catch(() => { /* best-effort temp cleanup */ });
    }
};
