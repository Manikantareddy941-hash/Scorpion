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
        const { stdout, stderr } = await execAsync(`semgrep scan --json --config auto "${targetPath}"`, { timeout: SCAN_TIMEOUT_MS });
        return { tool: 'semgrep', stdout, stderr };
    } catch (error: any) {
        if (error.killed) return { tool: 'semgrep', stdout: '', stderr: 'Scan timed out', error: 'TIMEOUT' };
        return { tool: 'semgrep', stdout: error.stdout || '', stderr: error.stderr || '' };
    }
};

export const runGitleaks = async (targetPath: string): Promise<ScanResult> => {
    try {
        const { stdout, stderr } = await execAsync(`gitleaks detect --source "${targetPath}" --format json --report-path -`, { timeout: SCAN_TIMEOUT_MS });
        return { tool: 'gitleaks', stdout, stderr };
    } catch (error: any) {
        if (error.killed) return { tool: 'gitleaks', stdout: '', stderr: 'Scan timed out', error: 'TIMEOUT' };
        return { tool: 'gitleaks', stdout: error.stdout || '', stderr: error.stderr || '' };
    }
};

export const runTrivy = async (targetPath: string): Promise<ScanResult> => {
    try {
        const { stdout, stderr } = await execAsync(`trivy fs --format json "${targetPath}"`, { timeout: SCAN_TIMEOUT_MS });
        return { tool: 'trivy', stdout, stderr };
    } catch (error: any) {
        if (error.killed) return { tool: 'trivy', stdout: '', stderr: 'Scan timed out', error: 'TIMEOUT' };
        return { tool: 'trivy', stdout: error.stdout || '', stderr: error.stderr || '' };
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

    return results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean) as ScanResult[];
};
