import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

// Wall-clock cap so a hung/slow nuclei run can't wedge the worker. Mirrors the
// ZAP poll timeout. Override with NUCLEI_TIMEOUT_MS.
const NUCLEI_TIMEOUT_MS = Number(process.env.NUCLEI_TIMEOUT_MS) || 10 * 60 * 1000;
// execFile buffers stdout in memory; a big template run can be verbose.
const MAX_BUFFER = 64 * 1024 * 1024;

// Subset of the nuclei JSONL object we consume; nuclei emits many more fields.
export interface NucleiResult {
    'template-id'?: string;
    'matched-at'?: string;
    host?: string;
    info?: {
        name?: string;
        severity?: string;
        description?: string;
        remediation?: string;
        classification?: { 'cve-id'?: string[] | null; 'cwe-id'?: string[] | null };
    };
}

/**
 * Runs nuclei against a target URL and returns parsed JSONL results.
 * `tags` optionally narrows the templates (e.g. 'cve,exposure'). Throws on a
 * nonzero exit that isn't nuclei's "findings present" case.
 */
export const runNuclei = async (targetUrl: string, tags?: string): Promise<NucleiResult[]> => {
    const args = ['-u', targetUrl, '-jsonl', '-silent', '-no-color'];
    if (tags) args.push('-tags', tags);

    logger.info(`[Nuclei] Scanning ${targetUrl}${tags ? ` (tags: ${tags})` : ''}`);

    let stdout = '';
    try {
        const result = await execFileAsync('nuclei', args, {
            timeout: NUCLEI_TIMEOUT_MS,
            maxBuffer: MAX_BUFFER,
        });
        stdout = result.stdout;
    } catch (error: unknown) {
        // nuclei exits 0 even with findings, so a throw here is a real failure
        // (binary missing, timeout, target unreachable). But it may still have
        // written partial JSONL to stdout before dying — parse what we have.
        const withStdout = error as { stdout?: string; killed?: boolean; message?: string };
        if (withStdout.killed) {
            throw new Error(`nuclei timed out after ${NUCLEI_TIMEOUT_MS}ms`);
        }
        if (!withStdout.stdout) {
            throw error;
        }
        stdout = withStdout.stdout;
    }

    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            try {
                return JSON.parse(line) as NucleiResult;
            } catch {
                logger.warn(`[Nuclei] Skipping unparseable output line`);
                return null;
            }
        })
        .filter((r): r is NucleiResult => r !== null);
};
