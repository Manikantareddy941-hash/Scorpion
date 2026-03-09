import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

// Safety: 5 minute timeout for any individual tool scan
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

export interface ScanResult {
    tool: 'semgrep' | 'gitleaks' | 'trivy';
    stdout: string;
    stderr: string;
    error?: string;
}

/**
 * Verifies that required security CLI tools are installed and accessible.
 */
export const validateTools = async (): Promise<{ tool: string, status: 'installed' | 'missing', version?: string }[]> => {
    const tools = [
        { name: 'semgrep', cmd: 'semgrep --version' },
        { name: 'gitleaks', cmd: 'gitleaks version' },
        { name: 'trivy', cmd: 'trivy --version' }
    ];

    const results = await Promise.all(tools.map(async (t) => {
        try {
            const { stdout } = await execAsync(t.cmd, { timeout: 10000 });
            return { tool: t.name, status: 'installed' as const, version: stdout.trim().split('\n')[0] };
        } catch (err) {
            return { tool: t.name, status: 'missing' as const };
        }
    }));

    return results;
};
export const runSemgrep = async (targetPath: string): Promise<ScanResult> => {
    try {
        // Use 'p/javascript' directly to avoid git requirement of '--config auto' during local tests
        const cmd = `semgrep scan --json --config "p/javascript" "${targetPath}"`;
        const { stdout, stderr } = await execAsync(cmd, {
            timeout: SCAN_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
        });
        return { tool: 'semgrep', stdout, stderr };
    } catch (error: any) {
        console.error('[Orchestrator] Semgrep failed:', error.message);
        return { tool: 'semgrep', stdout: error.stdout || '', stderr: error.stderr || error.message, error: error.killed ? 'TIMEOUT' : 'ERROR' };
    }
};

export const runGitleaks = async (targetPath: string): Promise<ScanResult> => {
    try {
        const cmd = `gitleaks detect --source "${targetPath}" --no-git --report-format json --report-path -`;
        const { stdout, stderr } = await execAsync(cmd, {
            timeout: SCAN_TIMEOUT_MS,
            maxBuffer: 5 * 1024 * 1024,
            env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
        });
        return { tool: 'gitleaks', stdout, stderr };
    } catch (error: any) {
        // Gitleaks returns exit code 1 when leaks are found, which is caught here.
        // We only log if it's a real failure (e.g. command not found).
        if (!error.stdout && !error.stderr) {
            console.error('[Orchestrator] Gitleaks execution failed:', error.message);
        }
        return { tool: 'gitleaks', stdout: error.stdout || '', stderr: error.stderr || error.message, error: error.killed ? 'TIMEOUT' : undefined };
    }
};

export const runTrivy = async (targetPath: string): Promise<ScanResult> => {
    try {
        const cmd = `trivy fs --format json "${targetPath}"`;
        const { stdout, stderr } = await execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
        return { tool: 'trivy', stdout, stderr };
    } catch (error: any) {
        console.error('[Orchestrator] Trivy failed:', error.message);
        return { tool: 'trivy', stdout: error.stdout || '', stderr: error.stderr || error.message, error: error.killed ? 'TIMEOUT' : 'ERROR' };
    }
};

export const orchestrateScan = async (targetPath: string) => {
    console.log(`[Orchestrator] Starting parallel scans for: ${targetPath}`);
    const start = Date.now();

    const results = await Promise.allSettled([
        runSemgrep(targetPath),
        runGitleaks(targetPath),
        runTrivy(targetPath)
    ]);

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[Orchestrator] Scans finalized in ${duration}s`);

    const fulfilled = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        const tools: Array<'semgrep' | 'gitleaks' | 'trivy'> = ['semgrep', 'gitleaks', 'trivy'];
        console.error(`[Orchestrator] ${tools[i]} failed to resolve:`, r.reason);
        return null;
    }).filter(Boolean) as ScanResult[];

    return fulfilled;
};
